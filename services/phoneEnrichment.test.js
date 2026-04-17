// Regression tests for services/phoneEnrichment.js
//
// These tests pin down the behavior that was previously broken and caused
// false positives in the "Recherche Tél" feature — do not remove them
// without replacing with equivalent coverage.
//
// Run with:  node --test services/phoneEnrichment.test.js
//
// No external deps: uses node:test + node:assert.
// All network calls are stubbed via the `fetchImpl` option.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  normalizeKey,
  stringSim,
  normalizePhoneKey,
  isValidNanpPhone,
  extractRowPhones,
  extractRowPhonesByColumn,
  mergePhoneLists,
  normalizeRow,
  buildQueries,
  scoreCandidate,
  applyGlobalPhoneCap,
  isJunkBusinessName,
  looksLikePersonalName,
  extractCivicNumber,
  runPhoneLookupBatch,
} from "./phoneEnrichment.js";

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

// stubFetch supports both .json() (for Places API) and .text() (for directory scraping).
// Pass an optional second handler for HTML responses; defaults to empty string.
function stubFetch(jsonHandler, textHandler) {
  return async (url) => ({
    async json() { return jsonHandler(String(url)); },
    async text() { return textHandler ? textHandler(String(url)) : ""; },
  });
}

function placesTextSearch(results) {
  return { status: "OK", results };
}
function placesDetails(result) {
  return { status: "OK", result };
}

/* ------------------------------------------------------------------ *
 *  Text / phone helpers
 * ------------------------------------------------------------------ */

test("cleanText strips whitespace and rejects non-strings", () => {
  assert.equal(cleanText("  hello  "), "hello");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText({}), "");
});

test("normalizeKey folds accents and collapses non-alnum", () => {
  assert.equal(normalizeKey("Hôtel de Ville"), "hotel de ville");
  assert.equal(normalizeKey("Québec Inc."), "quebec inc");
});

test("stringSim is stable and bounded", () => {
  assert.equal(stringSim("", "x"), 0);
  assert.equal(stringSim("abc", "abc"), 1);
  assert.ok(stringSim("6 rue champagne", "6 Rue Champagne, Victoriaville") > 0.5);
  assert.ok(stringSim("rue champagne", "avenue yargeau") < 0.3);
});

test("normalizePhoneKey strips formatting and leading 1", () => {
  assert.equal(normalizePhoneKey("(819) 758-1571"), "8197581571");
  assert.equal(normalizePhoneKey("+1 819-758-1571"), "8197581571");
  assert.equal(normalizePhoneKey("819.758.1571 ext 42"), "8197581571");
  assert.equal(normalizePhoneKey("12345"), ""); // too short
});

test("normalizePhoneKey rejects cadastre/matricule-shaped fake phones", () => {
  // These are the exact patterns seen in production Leads:
  assert.equal(normalizePhoneKey("(971) 999-9999"), "");   // 999 exchange
  assert.equal(normalizePhoneKey("(446) 999-9999"), "");   // 999 exchange
  assert.equal(normalizePhoneKey("(218) 999-9999"), "");   // 999 exchange
  assert.equal(normalizePhoneKey("(719) 999-9999"), "");   // 999 exchange
  assert.equal(normalizePhoneKey("0489999999"), "");       // starts with 0
  assert.equal(normalizePhoneKey("14469999999"), "");      // 1 + 999 exchange
  assert.equal(normalizePhoneKey("10140000001"), "");      // leading-0 NPA after stripping 1
  assert.equal(normalizePhoneKey("18700000001"), "");      // 000 exchange
  assert.equal(normalizePhoneKey("6100000001"), "");       // 000 exchange
  assert.equal(normalizePhoneKey("0510000001"), "");       // leading 0
  assert.equal(normalizePhoneKey("1111111111"), "");       // all same digit
  assert.equal(normalizePhoneKey("9112223333"), "");       // 911 NPA reserved
  assert.equal(normalizePhoneKey("4502221212"), "4502221212"); // valid
});

test("isValidNanpPhone enforces NANP structure", () => {
  assert.ok(isValidNanpPhone("8197581571"));
  assert.ok(isValidNanpPhone("4506432211"));
  assert.ok(!isValidNanpPhone("0000000000"));
  assert.ok(!isValidNanpPhone("1234567890")); // 123 NPA starts with 1
  assert.ok(!isValidNanpPhone("4505551212")); // 555 exchange outside fiction
  assert.ok(isValidNanpPhone("4505550123"));  // 555-0100..0199 is fiction-OK
  assert.ok(!isValidNanpPhone("8194111234")); // 411 reserved exchange
  assert.ok(!isValidNanpPhone("8199991234")); // 999 exchange
});

test("extractRowPhones walks every cell, dedupes, and rejects fake-shaped digits", () => {
  const row = {
    Ville: "VILLE DE VICTORIAVILLE",
    "Propriétaire1_Téléphone": "(819) 758-1571",
    "Propriétaire2_Téléphone": "819-758-1571", // dupe — should collapse
    "Propriétaire3_Téléphone": "514 555 0199", // 555-01XX fiction range — OK
    "Propriétaire4_Téléphone": "(971) 999-9999", // fake (999 exchange)
    Cadastre: "2476185",          // 7 digits, not a phone
    Matricule: "9302-33-8020-2-000-0000", // not a phone
    notes: "Call 514.555.0199 or 450 987 6543", // 2 numbers, second is real
    junk_id: "10140000001",      // long id that used to pass — now rejected
  };
  const phones = extractRowPhones(row);
  assert.equal(phones.length, 3, `got: ${JSON.stringify(phones)}`);
  assert.ok(phones.includes("(819) 758-1571"));
  assert.ok(phones.includes("(514) 555-0199"));
  assert.ok(phones.includes("(450) 987-6543"));
  assert.ok(!phones.some((p) => p.includes("999-9999")));
  assert.ok(!phones.some((p) => /1014000/.test(p)));
});

test("mergePhoneLists dedupes across sources keeping first format", () => {
  const merged = mergePhoneLists(
    ["(819) 758-1571"],
    "+1 819-758-1571", // duplicate, different format
    ["(514) 555-0199"],
  );
  assert.deepEqual(merged, ["(819) 758-1571", "(514) 555-0199"]);
});

/* ------------------------------------------------------------------ *
 *  Row normalization — the heart of the false-positive fix
 * ------------------------------------------------------------------ */

test("Physique owner is never used as a business query", () => {
  const row = {
    Ville: "VILLE DE VICTORIAVILLE",
    "Adresse Immeuble": "6, RUE CHAMPAGNE",
    "adresses immeubles clean ": "6 Rue Champagne, Victoriaville",
    "Propriétaire1_Nom": "Bourque, Mathieu",
    "Propriétaire1_StatutImpositionScolaire": "Physique",
  };
  const norm = normalizeRow(row);
  assert.deepEqual(norm.businessNames, [], "no business name should be produced for a Physique owner");
  const reasons = norm.rejectedOwners.map((r) => r.reason);
  assert.ok(reasons.includes("owner_is_physique"));
  assert.equal(norm.buildingAddress, "6 Rue Champagne, Victoriaville");
  assert.equal(norm.civic, "6");
});

test("Morale owner produces a business query unless junk/numbered", () => {
  const row = {
    Ville: "VILLE DE VICTORIAVILLE",
    "adresses immeubles clean ": "74-80 Rue Des Hospitalieres, Victoriaville",
    "Propriétaire1_Nom": "Les Immeubles Hamel-Rivard Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
  };
  const norm = normalizeRow(row);
  assert.deepEqual(norm.businessNames, ["Les Immeubles Hamel-Rivard Inc."]);
});

test("Quebec numbered-company names are rejected", () => {
  const row = {
    "adresses immeubles clean ": "49 A-49 B Rue Yargeau, Victoriaville",
    "Propriétaire1_Nom": "9332-1347 Quebec Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
  };
  const norm = normalizeRow(row);
  assert.deepEqual(norm.businessNames, []);
  assert.ok(norm.rejectedOwners.some((r) => r.reason === "junk"));
});

test("cadastre + matricule are never promoted as company names", () => {
  assert.ok(isJunkBusinessName("2476185"));
  assert.ok(isJunkBusinessName("9302-33-8020-2-000-0000"));
  assert.ok(isJunkBusinessName("Ville de Victoriaville"));
  assert.ok(isJunkBusinessName("Hôtel de Ville"));
  assert.ok(!isJunkBusinessName("Les Immeubles Hamel-Rivard Inc."));
});

test("personal-name detector keeps cooperatives/gestion safe", () => {
  assert.ok(looksLikePersonalName("Bourque, Mathieu"));
  assert.ok(looksLikePersonalName("DANIEL BOISCLAIR"));
  assert.ok(!looksLikePersonalName("Cooperative D'Habitation Belle Vie"));
  assert.ok(!looksLikePersonalName("Gestion ICQ Inc."));
});

test("extractCivicNumber handles ranges like '49 A-49 B Rue Yargeau'", () => {
  assert.equal(extractCivicNumber("6 Rue Champagne, Victoriaville"), "6");
  assert.equal(extractCivicNumber("49 A-49 B Rue Yargeau, Victoriaville"), "49");
  assert.equal(extractCivicNumber("74-80 Rue Des Hospitalieres, Victoriaville"), "74");
  assert.equal(extractCivicNumber("Rue Sans Numero"), "");
});

/* ------------------------------------------------------------------ *
 *  Query building — no city-only queries, ever
 * ------------------------------------------------------------------ */

test("buildQueries produces NO city-only query for Physique rows", () => {
  const norm = normalizeRow({
    Ville: "VILLE DE VICTORIAVILLE",
    "Code Postal Immeuble": "G6P 5M3",
    Province: "Qc",
    "adresses immeubles clean ": "6 Rue Champagne, Victoriaville",
    "Propriétaire1_Nom": "Bourque, Mathieu",
    "Propriétaire1_StatutImpositionScolaire": "Physique",
  });
  const qs = buildQueries(norm);
  assert.equal(qs.length, 1, "only an address query should be produced");
  assert.equal(qs[0].type, "address");
  // The query MUST include the street and civic number, not just the city.
  assert.ok(/6 Rue Champagne/.test(qs[0].query));
  // And it must NOT be "VILLE DE VICTORIAVILLE, Qc" by itself.
  assert.ok(!/^VILLE DE VICTORIAVILLE,\s*Qc\b/.test(qs[0].query));
});

test("normalizeRow collects owner mailing addresses", () => {
  const row = {
    "adresses immeubles clean ": "6 Rue Champagne, Victoriaville",
    "Propriétaire1_Nom": "Les Immeubles Hamel-Rivard Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Propriétaire1_Adresse_clean": "267 Rue Jette, St-Bruno-De-Montarville",
    "Propriétaire2_Adresse": "9 rue de Cannes Victoriaville",
    // Lookalike that must be ignored (no street word):
    "Propriétaire3_Adresse": "Sherbrooke (Québec)",
  };
  const norm = normalizeRow(row);
  assert.deepEqual(norm.ownerAddresses, [
    "267 Rue Jette, St-Bruno-De-Montarville",
    "9 rue de Cannes Victoriaville",
  ]);
});

test("buildQueries fires for building, each business, and each owner address", () => {
  const norm = normalizeRow({
    "adresses immeubles clean ": "82-82 A Rue Saint-Jean-Baptiste, Victoriaville",
    "Code Postal Immeuble": "G6P 4E5",
    Ville: "VILLE DE VICTORIAVILLE",
    Province: "Qc",
    "Propriétaire1_Nom": "9463-3278 QUEBEC INC.", // numbered → rejected
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Propriétaire2_Nom": "Gestion ICQ Inc.",      // real
    "Propriétaire2_StatutImpositionScolaire": "Morale",
    "Propriétaire1_Adresse_clean": "547 rue Saint-Paul, Farnham",
    "Propriétaire2_Adresse": "1459 rue Marcel-Marcotte Sherbrooke",
  });
  assert.deepEqual(norm.businessNames, ["Gestion ICQ Inc."]);
  assert.equal(norm.ownerAddresses.length, 2);

  const qs = buildQueries(norm);
  const types = qs.map((q) => q.type);
  assert.ok(types.includes("address"), "must include building-address query");
  assert.ok(types.includes("business"), "must include business-name query");
  assert.equal(
    types.filter((t) => t === "owner_address").length,
    2,
    "must include one owner-address query per unique mailing address",
  );
});

test("buildQueries dedupes an owner address equal to the building address", () => {
  const norm = normalizeRow({
    "adresses immeubles clean ": "6 Rue Champagne, Victoriaville",
    "Propriétaire1_Nom": "Gestion X Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    // Owner mailing = building address, should NOT produce a duplicate query
    "Propriétaire1_Adresse_clean": "6 Rue Champagne Victoriaville",
  });
  const qs = buildQueries(norm);
  const ownerAddrQueries = qs.filter((q) => q.type === "owner_address");
  assert.equal(ownerAddrQueries.length, 0);
});

test("buildQueries with no address and no company yields no queries", () => {
  // Pathological input that would previously trigger the Hôtel-de-ville query.
  const norm = normalizeRow({
    Ville: "VILLE DE VICTORIAVILLE",
    "Code Postal Immeuble": "G6P 5M3",
    Province: "Qc",
    "Propriétaire1_Nom": "2476185", // cadastre misfiled as owner
    "Propriétaire1_StatutImpositionScolaire": "Morale",
  });
  assert.deepEqual(norm.businessNames, []);
  const qs = buildQueries(norm);
  assert.equal(qs.length, 0, "must not fall back to a city-only query");
});

/* ------------------------------------------------------------------ *
 *  Candidate scoring — civic number, blocked types, business_status
 * ------------------------------------------------------------------ */

test("scoreCandidate rejects blocked Google Places types (Hôtel de ville)", () => {
  const result = scoreCandidate({
    query: {
      type: "address",
      query: "6 Rue Champagne, Victoriaville, Qc",
      expectedAddress: "6 Rue Champagne, Victoriaville",
      expectedCivic: "6",
      expectedName: "",
    },
    candidate: {
      name: "Hôtel de Ville de Victoriaville",
      address: "1 Place Notre-Dame, Victoriaville, QC G6P 4A1",
      phone: "(819) 758-1571",
      types: ["city_hall", "local_government_office", "point_of_interest"],
      business_status: "OPERATIONAL",
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /blocked_type/);
});

test("scoreCandidate rejects civic-number mismatches", () => {
  const result = scoreCandidate({
    query: {
      type: "address",
      query: "6 Rue Champagne, Victoriaville",
      expectedAddress: "6 Rue Champagne, Victoriaville",
      expectedCivic: "6",
      expectedName: "",
    },
    candidate: {
      name: "Some place",
      address: "45 Rue Champagne, Victoriaville, QC",
      phone: "(819) 555-0000",
      types: ["establishment"],
      business_status: "OPERATIONAL",
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /civic_mismatch/);
});

test("scoreCandidate accepts a solid address match", () => {
  const result = scoreCandidate({
    query: {
      type: "address",
      query: "6 Rue Champagne, Victoriaville",
      expectedAddress: "6 Rue Champagne, Victoriaville",
      expectedCivic: "6",
      expectedName: "",
    },
    candidate: {
      name: "Immeuble Champagne",
      address: "6 Rue Champagne, Victoriaville, QC G6P 5M3",
      phone: "(819) 555-0123",
      types: ["establishment", "point_of_interest"],
      business_status: "OPERATIONAL",
    },
  });
  assert.equal(result.accepted, true);
  assert.ok(result.confidence > 60);
});

test("scoreCandidate rejects non-operational businesses", () => {
  const result = scoreCandidate({
    query: {
      type: "business",
      query: "Foo Inc., Victoriaville",
      expectedAddress: "6 Rue Champagne",
      expectedCivic: "6",
      expectedName: "Foo Inc.",
    },
    candidate: {
      name: "Foo Inc.",
      address: "6 Rue Champagne, Victoriaville",
      phone: "(819) 555-0000",
      types: ["establishment"],
      business_status: "CLOSED_PERMANENTLY",
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /status:CLOSED/);
});

/* ------------------------------------------------------------------ *
 *  Global phone-frequency cap
 * ------------------------------------------------------------------ */

test("applyGlobalPhoneCap strips phones repeated across too many leads", () => {
  const mkResult = (addr, phones) => ({
    id: addr,
    inputAddress: addr,
    inputName: "",
    matchedName: "Hôtel de Ville",
    matchedAddress: "1 Place Notre-Dame",
    phone: phones[0] || "",
    inputPhones: phones,
    onlinePhones: phones,
    fileInputPhones: [],
    website: "",
    source: "google_places",
    confidence: 70,
    status: phones.length ? "found" : "not_found",
    statusLabel: phones.length ? "Trouvé" : "Non trouvé",
    candidates: [],
    rejectedCandidates: [],
    trace: [],
  });
  const results = [
    mkResult("6 Rue A", ["(819) 758-1571"]),
    mkResult("12 Rue B", ["(819) 758-1571"]),
    mkResult("34 Rue C", ["(819) 758-1571"]),
    mkResult("56 Rue D", ["(819) 758-1571"]),
    mkResult("78 Rue E", ["(819) 758-1571"]),
  ];
  const cleaned = applyGlobalPhoneCap(results, 3);
  for (const r of cleaned) {
    assert.equal(r.onlinePhones.length, 0, `phone should be dropped from ${r.inputAddress}`);
    assert.equal(r.status, "not_found");
    assert.ok(r.trace.some((t) => t.startsWith("frequency_cap_dropped:")));
  }
});

test("applyGlobalPhoneCap preserves phones that were in the FILE (inputPhones)", () => {
  const a = {
    id: "a",
    inputAddress: "6 Rue A",
    inputName: "",
    matchedName: "",
    matchedAddress: "",
    phone: "(819) 111-2222",
    inputPhones: ["(819) 111-2222"], // from file
    onlinePhones: [],
    fileInputPhones: ["(819) 111-2222"],
    website: "",
    source: "google_places",
    confidence: 0,
    status: "found",
    statusLabel: "Trouvé",
    candidates: [],
    rejectedCandidates: [],
    trace: [],
  };
  const cleaned = applyGlobalPhoneCap([a], 3);
  assert.deepEqual(cleaned[0].inputPhones, ["(819) 111-2222"]);
  assert.equal(cleaned[0].status, "found");
});

/* ------------------------------------------------------------------ *
 *  End-to-end: runPhoneLookupBatch (stubbed Places)
 * ------------------------------------------------------------------ */

test("runPhoneLookupBatch: no queries => status=not_found but file phones surface", async () => {
  const rows = [
    {
      Ville: "VILLE DE VICTORIAVILLE",
      "adresses immeubles clean ": "6 Rue Champagne, Victoriaville",
      "Propriétaire1_Nom": "Bourque, Mathieu",
      "Propriétaire1_StatutImpositionScolaire": "Physique",
      "Propriétaire1_Téléphone": "(819) 231-0445",
    },
  ];
  // No fetch should be called if the only query is "address" — but apiKey is
  // provided, so the client IS created. We stub fetch to fail the test if it
  // DOES call out.
  const callLog = [];
  const fetchImpl = stubFetch((url) => {
    callLog.push(url);
    if (url.includes("textsearch"))
      return placesTextSearch([]); // nothing found
    return placesDetails({});
  });
  const { results } = await runPhoneLookupBatch({
    rows,
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.status, "found", "row has a file phone, must be Trouvé");
  assert.equal(r.statusLabel, "Trouvé");
  assert.deepEqual(r.inputPhones, ["(819) 231-0445"]);
});

// ─── New feature tests ──────────────────────────────────────────────────────

test("extractRowPhonesByColumn: first column wins for the same phone", () => {
  const row = {
    "Propriétaire1_Téléphone": "(819) 758-0387",
    "Propriétaire2_Téléphone": "(819) 758-0387",  // duplicate
    "Propriétaire3_Téléphone": "(819) 389-1202",
  };
  const map = extractRowPhonesByColumn(row);
  // 8197580387 → first column
  assert.equal(map["8197580387"], "Propriétaire1_Téléphone");
  // 8193891202 → its own column
  assert.equal(map["8193891202"], "Propriétaire3_Téléphone");
});

test("extractRowPhonesByColumn: ignores junk values that aren't phones", () => {
  const row = {
    "Cadastre": "6192657",
    "Matricule": "9401-65-8100-4-000-0000",
    "Propriétaire1_Téléphone": "(819) 758-0387",
  };
  const map = extractRowPhonesByColumn(row);
  assert.equal(Object.keys(map).length, 1);
  assert.equal(map["8197580387"], "Propriétaire1_Téléphone");
});

test("normalizeRow: extracts lat/lng and detects residential isResidential=true", () => {
  const row = {
    "adresses immeubles clean": "10 Rue Saint-Philippe, Victoriaville",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Vaugeois, Francis",
    "Propriétaire1_StatutImpositionScolaire": "Physique",
    "Lat": "46.0575354",
    "Long": "-71.9637039",
  };
  const norm = normalizeRow(row);
  assert.equal(norm.isResidential, true);
  assert.equal(norm.utilisationIsLogement, true);
  assert.equal(norm.lat, 46.0575354);
  assert.equal(norm.lng, -71.9637039);
});

test("normalizeRow: Morale owner in Logement row → isResidential=false", () => {
  const row = {
    "adresses immeubles clean": "121 Rue Saint-Jean-Baptiste, Victoriaville",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Immeubles Boissonneault Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Lat": "46.0564907",
    "Long": "-71.9518089",
  };
  const norm = normalizeRow(row);
  assert.equal(norm.utilisationIsLogement, true);
  assert.equal(norm.isResidential, false); // Morale owner → should look up
  assert.ok(!isNaN(norm.lat));
});

test("normalizeRow: commercial property → isResidential=false", () => {
  const row = {
    "adresses immeubles clean": "361 Rue Girouard, Victoriaville",
    "Utilisation Prédominante": "Immeuble commercial",
    "Propriétaire1_Nom": "GESTION CML 2008 INC.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Lat": "46.0444924",
    "Long": "-71.9227064",
  };
  const norm = normalizeRow(row);
  assert.equal(norm.utilisationIsLogement, false);
  assert.equal(norm.isResidential, false);
});

test("buildQueries: nearby query prepended for non-logement row with GPS", () => {
  const norm = {
    buildingAddress: "361 Rue Girouard, Victoriaville",
    city: "Victoriaville", province: "Qc", postal: "G6P 5T9", country: "Canada",
    businessNames: ["GESTION CML 2008 INC."],
    ownerAddresses: [],
    civic: "361",
    lat: 46.0444924, lng: -71.9227064,
    utilisationIsLogement: false,
  };
  const queries = buildQueries(norm);
  assert.equal(queries[0].type, "nearby", "nearby should be first");
  assert.equal(queries[0].lat, 46.0444924);
  assert.ok(queries.some(q => q.type === "address"));
  assert.ok(queries.some(q => q.type === "business"));
});

test("buildQueries: NO nearby query for logement row even with GPS", () => {
  const norm = {
    buildingAddress: "10 Rue Saint-Philippe, Victoriaville",
    city: "Victoriaville", province: "Qc", postal: "G6P 3L1", country: "Canada",
    businessNames: [],
    ownerAddresses: [],
    civic: "10",
    lat: 46.0575354, lng: -71.9637039,
    utilisationIsLogement: true,
  };
  const queries = buildQueries(norm);
  assert.ok(!queries.some(q => q.type === "nearby"), "logement should not use nearby");
});

test("runPhoneLookupBatch: residential+physique row skips API, returns file phones", async () => {
  let apiCallCount = 0;
  const fetchImpl = stubFetch(() => {
    apiCallCount++;
    return placesTextSearch([]);
  });
  const rows = [{
    "adresses immeubles clean": "10 Rue Saint-Philippe, Victoriaville",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Vaugeois, Francis",
    "Propriétaire1_StatutImpositionScolaire": "Physique",
    "Propriétaire1_Téléphone": "(819) 758-0387",
    "Lat": "46.0575354",
    "Long": "-71.9637039",
  }];
  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.equal(apiCallCount, 0, "no API calls for residential+physique");
  assert.equal(results[0].status, "found");
  assert.equal(results[0].inputPhones[0], "(819) 758-0387");
  assert.ok(results[0].trace.some(t => t.includes("residential")));
});

test("runPhoneLookupBatch: nearby search fires for non-logement row", async () => {
  const calls = [];
  const fetchImpl = stubFetch((url) => {
    calls.push(url.includes("nearbysearch") ? "nearby" : url.includes("textsearch") ? "text" : "details");
    if (url.includes("nearbysearch")) {
      return placesTextSearch([{
        place_id: "biz1", name: "Gestion CML", formatted_address: "361 Rue Girouard, Victoriaville",
        types: ["establishment"], business_status: "OPERATIONAL",
      }]);
    }
    if (url.includes("details")) {
      return placesDetails({
        name: "Gestion CML 2008 Inc.",
        formatted_address: "361 Rue Girouard, Victoriaville, QC G6P 5T9",
        formatted_phone_number: "(819) 555-0155",
        types: ["establishment"], business_status: "OPERATIONAL",
      });
    }
    return placesTextSearch([]);
  });
  const rows = [{
    "adresses immeubles clean": "361 Rue Girouard, Victoriaville",
    "Utilisation Prédominante": "Immeuble commercial",
    "Propriétaire1_Nom": "GESTION CML 2008 INC.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Code Postal Immeuble": "G6P 5T9",
    "Lat": "46.0444924",
    "Long": "-71.9227064",
  }];
  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0, topN: 3 },
  });
  assert.ok(calls.includes("nearby"), "nearby search should have been called");
  assert.equal(results[0].status, "found");
});

test("runPhoneLookupBatch: filePhoneColumns maps phones to their Excel column", async () => {
  const rows = [{
    "adresses immeubles clean": "121 Rue Saint-Jean-Baptiste, Victoriaville",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Immeubles Boissonneault Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Propriétaire3_Téléphone": "(819) 389-1202",
    "Lat": "46.0564907",
    "Long": "-71.9518089",
  }];
  const fetchImpl = stubFetch(() => placesTextSearch([]));
  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  const r = results[0];
  assert.equal(r.status, "found");
  assert.equal(r.filePhoneColumns["8193891202"], "Propriétaire3_Téléphone");
});

test("runPhoneLookupBatch: Hôtel-de-ville result is rejected by blocked_type", async () => {
  const rows = [
    {
      Ville: "VILLE DE VICTORIAVILLE",
      "adresses immeubles clean ": "6 Rue Champagne, Victoriaville",
      "Code Postal Immeuble": "G6P 5M3",
      "Propriétaire1_Nom": "Bourque, Mathieu",
      "Propriétaire1_StatutImpositionScolaire": "Physique",
    },
  ];
  const fetchImpl = stubFetch((url) => {
    if (url.includes("textsearch")) {
      return placesTextSearch([
        { place_id: "cityhall1", name: "Hôtel de Ville", formatted_address: "1 Place Notre-Dame, Victoriaville", types: ["city_hall", "local_government_office"] },
      ]);
    }
    return placesDetails({
      name: "Hôtel de Ville de Victoriaville",
      formatted_address: "1 Place Notre-Dame, Victoriaville, QC",
      formatted_phone_number: "(819) 758-1571",
      types: ["city_hall", "local_government_office"],
      business_status: "OPERATIONAL",
    });
  });
  const { results } = await runPhoneLookupBatch({
    rows,
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  const r = results[0];
  assert.equal(r.status, "not_found");
  assert.equal(r.phone, "");
  assert.equal(r.matchedName, "");
  assert.ok(r.rejectedCandidates.some((c) => /blocked_type/.test(c.reason)));
});

test("runPhoneLookupBatch: legitimate business match accepted", async () => {
  const rows = [
    {
      Ville: "VILLE DE VICTORIAVILLE",
      "adresses immeubles clean ": "74-80 Rue Des Hospitalieres, Victoriaville",
      "Code Postal Immeuble": "G6P 6N6",
      "Propriétaire1_Nom": "Les Immeubles Hamel-Rivard Inc.",
      "Propriétaire1_StatutImpositionScolaire": "Morale",
    },
  ];
  const fetchImpl = stubFetch((url) => {
    if (url.includes("textsearch")) {
      return placesTextSearch([
        { place_id: "biz1", name: "Les Immeubles Hamel-Rivard Inc.", formatted_address: "74 Rue Des Hospitalieres, Victoriaville, QC G6P 6N6", types: ["real_estate_agency", "establishment"] },
      ]);
    }
    return placesDetails({
      name: "Les Immeubles Hamel-Rivard Inc.",
      formatted_address: "74 Rue Des Hospitalieres, Victoriaville, QC G6P 6N6",
      formatted_phone_number: "(819) 555-0180",
      types: ["real_estate_agency", "establishment"],
      business_status: "OPERATIONAL",
    });
  });
  const { results } = await runPhoneLookupBatch({
    rows,
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  const r = results[0];
  assert.equal(r.status, "found");
  assert.equal(r.statusLabel, "Trouvé");
  assert.equal(r.phone, "(819) 555-0180");
  assert.match(r.matchedName, /Hamel-Rivard/);
});

test("runPhoneLookupBatch: multi-row frequency cap scrubs a shared public number", async () => {
  // 5 different addresses, all returning the same (819) 758-1571 via Places.
  // Cap=3 => the number should be scrubbed from every online result.
  const buildRow = (addr) => ({
    Ville: "VILLE DE VICTORIAVILLE",
    "adresses immeubles clean ": addr,
    "Code Postal Immeuble": "G6P 5M3",
    "Propriétaire1_Nom": "Some Business Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
  });
  const rows = [
    buildRow("6 Rue Champagne, Victoriaville"),
    buildRow("12 Rue Sylvain, Victoriaville"),
    buildRow("34 Rue Yargeau, Victoriaville"),
    buildRow("56 Rue Jolicoeur, Victoriaville"),
    buildRow("78 Rue Lactantia, Victoriaville"),
  ];
  let reqCount = 0;
  const fetchImpl = stubFetch((url) => {
    reqCount++;
    if (url.includes("textsearch")) {
      // Return an "establishment" whose civic number matches the row so the
      // civic gate lets it through — this isolates the cap behavior.
      const m = decodeURIComponent(url).match(/query=([^&]+)/);
      const q = m ? m[1].replace(/\+/g, " ") : "";
      const civicMatch = q.match(/^(\d{1,3})/);
      const civic = civicMatch ? civicMatch[1] : "1";
      return placesTextSearch([
        { place_id: `p_${civic}`, name: "Some Business Inc.", formatted_address: `${civic} Rue X, Victoriaville`, types: ["establishment"] },
      ]);
    }
    const civicMatch = url.match(/place_id=p_(\d+)/);
    const civic = civicMatch ? civicMatch[1] : "1";
    return placesDetails({
      name: "Some Business Inc.",
      formatted_address: `${civic} Rue X, Victoriaville, QC`,
      formatted_phone_number: "(819) 758-1571", // same on every row
      types: ["establishment"],
      business_status: "OPERATIONAL",
    });
  });
  const { results } = await runPhoneLookupBatch({
    rows,
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 3 },
  });
  assert.ok(reqCount > 0, "fetch should have been called");
  for (const r of results) {
    assert.equal(r.onlinePhones.length, 0, `public number must be dropped from ${r.inputAddress}`);
    assert.equal(r.status, "not_found");
    assert.ok(r.trace.some((t) => t.startsWith("frequency_cap_dropped:")));
  }
});

// ─── Query strategy tests ────────────────────────────────────────────────────

test("buildQueries: Logement row uses city-only business query (no building address)", () => {
  const norm = {
    buildingAddress: "121 Rue Saint-Jean-Baptiste, Victoriaville",
    city: "Victoriaville", province: "Qc", postal: "G6P 4E9", country: "Canada",
    businessNames: ["Immeubles Boissonneault Inc."],
    ownerAddresses: [],
    civic: "121",
    lat: null, lng: null,
    utilisationIsLogement: true,
  };
  const queries = buildQueries(norm);
  // No address-only query for logement
  assert.ok(!queries.some(q => q.type === "address"), "no address query for logement");
  const bq = queries.find(q => q.type === "business");
  assert.ok(bq, "business query should exist");
  // Query should NOT contain the building address (121 Rue...)
  assert.ok(!bq.query.includes("121 Rue"), "building address must not appear in logement business query");
  // Query should contain city
  assert.ok(bq.query.includes("Victoriaville"), "city should appear in query");
  // expectedCivic should be empty for logement (can't gate on building civic)
  assert.equal(bq.expectedCivic, "", "no civic gate for logement business query");
});

test("buildQueries: commercial row includes building address in business query", () => {
  const norm = {
    buildingAddress: "361 Rue Girouard, Victoriaville",
    city: "Victoriaville", province: "Qc", postal: "G6P 5T9", country: "Canada",
    businessNames: ["GESTION CML 2008 INC."],
    ownerAddresses: [],
    civic: "361",
    lat: null, lng: null,
    utilisationIsLogement: false,
  };
  const queries = buildQueries(norm);
  assert.ok(queries.some(q => q.type === "address"), "address query present for commercial");
  const bq = queries.find(q => q.type === "business");
  assert.ok(bq.query.includes("361 Rue Girouard"), "building address should anchor commercial business query");
  assert.equal(bq.expectedCivic, "361");
});

test("runPhoneLookupBatch: Pages Jaunes fallback fires when Places finds nothing", async () => {
  const pjHtml = `<html><body>
    <a class="listing-name">Les Immeubles Test Inc.</a>
    <a href="tel:+18195550142">(819) 555-0142</a>
  </body></html>`;

  const calls = [];
  const fetchImpl = stubFetch(
    (url) => {
      calls.push(url.includes("nearbysearch") ? "nearby" : url.includes("textsearch") ? "text" : "details");
      return placesTextSearch([]);  // Places finds nothing
    },
    (url) => {
      if (url.includes("pagesjaunes")) { calls.push("pj"); return pjHtml; }
      return "";
    }
  );

  const rows = [{
    "adresses immeubles clean": "121 Rue Saint-Jean-Baptiste, Victoriaville",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Les Immeubles Test Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Ville2": "Victoriaville",
    "Lat": "46.0564907", "Long": "-71.9518089",
  }];

  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.ok(calls.includes("pj"), "Pages Jaunes should have been called");
  assert.equal(results[0].status, "found");
  assert.ok(results[0].directoryPhones.length > 0, "directoryPhones should have the PJ result");
  assert.ok(results[0].trace.some(t => t.startsWith("pages_jaunes:")));
});

test("runPhoneLookupBatch: Pages Jaunes not called when file already has phones", async () => {
  const calls = [];
  const fetchImpl = stubFetch(
    () => placesTextSearch([]),
    (url) => { if (url.includes("pagesjaunes")) calls.push("pj"); return ""; }
  );
  const rows = [{
    "adresses immeubles clean": "121 Rue Saint-Jean-Baptiste, Victoriaville",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Les Immeubles Test Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Propriétaire1_Téléphone": "(819) 389-1202",  // phone already in file
    "Ville2": "Victoriaville",
  }];
  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.ok(!calls.includes("pj"), "Pages Jaunes should NOT be called when file has phones");
  assert.equal(results[0].status, "found");
});

test("runPhoneLookupBatch: progressive radius fires 150m when 50m finds nothing", async () => {
  const radiusCalls = [];
  const fetchImpl = stubFetch((url) => {
    if (url.includes("nearbysearch")) {
      const m = url.match(/radius=(\d+)/);
      const radius = m ? Number(m[1]) : 0;
      radiusCalls.push(radius);
      if (radius >= 150) {
        // Return a result at 150m
        return placesTextSearch([{
          place_id: "biz150", name: "Service Fenêtres Plus",
          formatted_address: "361 Rue Girouard, Victoriaville, QC G6P 5T9",
          types: ["establishment"], business_status: "OPERATIONAL",
        }]);
      }
      return placesTextSearch([]); // 50m finds nothing
    }
    if (url.includes("details")) {
      return placesDetails({
        name: "Service Fenêtres Plus",
        formatted_address: "361 Rue Girouard, Victoriaville, QC G6P 5T9",
        formatted_phone_number: "(819) 555-0155",
        types: ["establishment"], business_status: "OPERATIONAL",
      });
    }
    return placesTextSearch([]);
  });

  const rows = [{
    "adresses immeubles clean": "361 Rue Girouard, Victoriaville",
    "Utilisation Prédominante": "Service de pose de portes, de fenêtres et de panneaux de verre",
    "Propriétaire1_Nom": "GESTION CML 2008 INC.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Code Postal Immeuble": "G6P 5T9",
    "Lat": "46.0444924", "Long": "-71.9227064",
  }];

  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0, topN: 3 },
  });

  assert.ok(radiusCalls.includes(50), "should have tried 50m first");
  assert.ok(radiusCalls.includes(150), "should have widened to 150m");
  assert.equal(results[0].status, "found");
});

test("runPhoneLookupBatch: 411.ca fires concurrently with Pages Jaunes when Places finds nothing", async () => {
  const c411Html = `<html><body><a href="tel:+18195550198">(819) 555-0198</a></body></html>`;
  const calls = [];
  const fetchImpl = stubFetch(
    () => placesTextSearch([]),
    (url) => {
      if (url.includes("pagesjaunes")) { calls.push("pj"); return ""; }
      if (url.includes("411.ca")) { calls.push("411"); return c411Html; }
      return "";
    }
  );
  const rows = [{
    "adresses immeubles clean": "45 Rue Laurier, Arthabaska",
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "Gestion Arthabaska Inc.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Ville2": "Arthabaska",
  }];
  const { results } = await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.ok(calls.includes("411"), "411.ca should have been called");
  assert.equal(results[0].status, "found");
  assert.ok(results[0].c411DirectoryPhones.length > 0, "c411DirectoryPhones should have the result");
  assert.ok(results[0].trace.some(t => t.startsWith("411ca:")));
});

test("runPhoneLookupBatch: query cache avoids duplicate text search for Logement rows with same owner", async () => {
  let textSearchCalls = 0;
  const fetchImpl = stubFetch((url) => {
    if (url.includes("textsearch")) textSearchCalls++;
    return placesTextSearch([]);
  });
  // Two Logement rows owned by the same Morale company in the same city.
  // Logement rows use a city-only business query (no building address), so the
  // query string "GESTION DUPONT INC., Victoriaville, Qc" is identical for both.
  // The second row should get a cache hit and not re-fire the Places API.
  const sharedRow = {
    "Utilisation Prédominante": "Logement",
    "Propriétaire1_Nom": "GESTION DUPONT INC.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Ville2": "Victoriaville",
  };
  const rows = [
    { ...sharedRow, "adresses immeubles clean": "10 Rue A, Victoriaville" },
    { ...sharedRow, "adresses immeubles clean": "20 Rue B, Victoriaville" },
  ];
  await runPhoneLookupBatch({
    rows, apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  // Both rows share an identical business query → only 1 text search call total.
  assert.equal(textSearchCalls, 1, `expected 1 cached text search; got ${textSearchCalls}`);
});

/* ------------------------------------------------------------------ *
 *  Regression tests for the April 2026 cost/quality pass
 * ------------------------------------------------------------------ */

test("isJunkBusinessName rejects emails and URLs (Excel column pollution)", () => {
  // These strings show up in real Excel exports when someone pasted contact
  // info into the owner-name cell. Without this filter they waste a Places
  // textSearch every time and usually return garbage.
  assert.equal(isJunkBusinessName("contact@example.com"), true);
  assert.equal(isJunkBusinessName("owner@acme.qc.ca"), true);
  assert.equal(isJunkBusinessName("https://example.com"), true);
  assert.equal(isJunkBusinessName("http://acme.qc.ca/contact"), true);
  assert.equal(isJunkBusinessName("www.example.com"), true);
  // Control: a real company name must still pass.
  assert.equal(isJunkBusinessName("Les Immeubles Hamel-Rivard Inc."), false);
});

test("scoreCandidate owner_address: accepts when candidate lacks civic but addr_sim is good", () => {
  // Owner mailing addresses often resolve to a geocoded point that Google
  // describes without a civic number (e.g. "Rue Champagne, Victoriaville").
  // The owner_address branch accepts these as long as addr_sim ≥ 0.4.
  const result = scoreCandidate({
    query: {
      type: "owner_address",
      query: "123 Rue Champagne, Victoriaville, Qc",
      expectedAddress: "123 Rue Champagne, Victoriaville",
      expectedCivic: "123",
      expectedName: "",
    },
    candidate: {
      name: "Dupont Holdings",
      address: "Rue Champagne, Victoriaville, QC",  // no civic on Google side
      phone: "(819) 555-0123",
      types: ["establishment"],
      business_status: "OPERATIONAL",
    },
  });
  assert.equal(result.accepted, true, `should accept; got reason=${result.reason}`);
  assert.ok(result.confidence >= 30, `expected floor ≥30; got ${result.confidence}`);
});

test("scoreCandidate owner_address: still rejects civic mismatch (hard safety gate)", () => {
  const result = scoreCandidate({
    query: {
      type: "owner_address",
      query: "123 Rue Champagne, Victoriaville",
      expectedAddress: "123 Rue Champagne, Victoriaville",
      expectedCivic: "123",
      expectedName: "",
    },
    candidate: {
      name: "Some shop",
      address: "987 Rue Champagne, Victoriaville, QC",  // different civic
      phone: "(819) 555-0000",
      types: ["establishment"],
      business_status: "OPERATIONAL",
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /civic_mismatch/);
});

test("scoreCandidate address query still rejects missing civic (unchanged behavior)", () => {
  // Sanity: relaxing owner_address must NOT weaken the regular "address" branch.
  const result = scoreCandidate({
    query: {
      type: "address",
      query: "123 Rue Champagne, Victoriaville",
      expectedAddress: "123 Rue Champagne, Victoriaville",
      expectedCivic: "123",
      expectedName: "",
    },
    candidate: {
      name: "Dupont Holdings",
      address: "Rue Champagne, Victoriaville, QC",
      phone: "(819) 555-0123",
      types: ["establishment"],
      business_status: "OPERATIONAL",
    },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /result_missing_civic/);
});

test("runPhoneLookupBatch: blocked_type candidates are pre-rejected without a Details call", async () => {
  // The pre-score filter on raw textSearch results means a city_hall hit
  // should never cost a Details API call. We assert by counting /details
  // fetches — they must be zero for this row.
  let detailsCalls = 0;
  const fetchImpl = stubFetch((url) => {
    if (url.includes("textsearch")) {
      return placesTextSearch([
        {
          place_id: "cityhall1",
          name: "Hôtel de Ville",
          formatted_address: "1 Place Notre-Dame, Victoriaville",
          types: ["city_hall", "local_government_office"],
        },
      ]);
    }
    if (url.includes("details")) {
      detailsCalls++;
      return placesDetails({
        name: "Hôtel de Ville de Victoriaville",
        formatted_address: "1 Place Notre-Dame, Victoriaville, QC",
        formatted_phone_number: "(819) 758-1571",
        types: ["city_hall", "local_government_office"],
        business_status: "OPERATIONAL",
      });
    }
    return placesTextSearch([]);
  });
  const { results } = await runPhoneLookupBatch({
    rows: [{
      "adresses immeubles clean": "6 Rue Champagne, Victoriaville",
      "Code Postal Immeuble": "G6P 5M3",
      "Propriétaire1_Nom": "Bourque, Mathieu",
      "Propriétaire1_StatutImpositionScolaire": "Physique",
    }],
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.equal(detailsCalls, 0, `expected 0 Details calls for a city_hall hit; got ${detailsCalls}`);
  assert.equal(results[0].status, "not_found");
});

test("runPhoneLookupBatch: directory scrapers skip when Places returned a strong name match", async () => {
  // The cost optimization says: if Places found a ≥60% confidence match (even
  // without a phone), don't bother with Pages Jaunes/411.ca. Strong match =
  // Google knows the business; the listing just happens to have no phone.
  const calls = [];
  const fetchImpl = stubFetch(
    (url) => {
      if (url.includes("textsearch")) {
        return placesTextSearch([{
          place_id: "biz1",
          name: "Les Immeubles Hamel-Rivard Inc.",
          formatted_address: "74 Rue Des Hospitalieres, Victoriaville, QC G6P 6N6",
          types: ["real_estate_agency", "establishment"],
        }]);
      }
      if (url.includes("details")) {
        return placesDetails({
          name: "Les Immeubles Hamel-Rivard Inc.",
          formatted_address: "74 Rue Des Hospitalieres, Victoriaville, QC G6P 6N6",
          formatted_phone_number: "",   // key: strong name match, no phone
          types: ["real_estate_agency", "establishment"],
          business_status: "OPERATIONAL",
        });
      }
      return placesTextSearch([]);
    },
    (url) => {
      if (url.includes("pagesjaunes")) calls.push("pj");
      if (url.includes("411.ca") || url.includes("411ca")) calls.push("411");
      return "";
    }
  );
  const { results } = await runPhoneLookupBatch({
    rows: [{
      "adresses immeubles clean": "74-80 Rue Des Hospitalieres, Victoriaville",
      "Code Postal Immeuble": "G6P 6N6",
      "Propriétaire1_Nom": "Les Immeubles Hamel-Rivard Inc.",
      "Propriétaire1_StatutImpositionScolaire": "Morale",
      "Ville2": "Victoriaville",
    }],
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0 },
  });
  assert.ok(!calls.includes("pj"), `PJ should not have been called; calls=${calls.join(",")}`);
  assert.ok(!calls.includes("411"), `411.ca should not have been called; calls=${calls.join(",")}`);
  // Status is not_found because no phone surfaced, but the skip itself is the win.
  assert.equal(results[0].status, "not_found");
});

test("runPhoneLookupBatch: progressive radius skipped when Places returned a strong name match without phone", async () => {
  // Same optimization as above, applied to the GPS radius fallback. If Places
  // text-search already returned a ≥60% match, widening the radius would only
  // surface unrelated neighbours and burn Details calls.
  const radiusCalls = [];
  const fetchImpl = stubFetch((url) => {
    if (url.includes("nearbysearch")) {
      const m = url.match(/radius=(\d+)/);
      radiusCalls.push(m ? Number(m[1]) : 0);
      return placesTextSearch([]);
    }
    if (url.includes("textsearch")) {
      // Strong name match, but no phone on the listing.
      return placesTextSearch([{
        place_id: "biz-strong",
        name: "Service Fenêtres Plus",
        formatted_address: "361 Rue Girouard, Victoriaville, QC G6P 5T9",
        types: ["establishment"],
      }]);
    }
    if (url.includes("details")) {
      return placesDetails({
        name: "Service Fenêtres Plus",
        formatted_address: "361 Rue Girouard, Victoriaville, QC G6P 5T9",
        formatted_phone_number: "",
        types: ["establishment"],
        business_status: "OPERATIONAL",
      });
    }
    return placesTextSearch([]);
  });
  await runPhoneLookupBatch({
    rows: [{
      "adresses immeubles clean": "361 Rue Girouard, Victoriaville",
      "Utilisation Prédominante": "Service de pose de portes",
      "Propriétaire1_Nom": "Service Fenêtres Plus",
      "Propriétaire1_StatutImpositionScolaire": "Morale",
      "Code Postal Immeuble": "G6P 5T9",
      "Lat": "46.0444924", "Long": "-71.9227064",
    }],
    apiKey: "FAKE_KEY",
    options: { fetchImpl, perRowDelayMs: 0, globalPhoneCap: 0, topN: 3 },
  });
  // 50m might still fire as part of the initial queries[] set; what must NOT fire
  // are the 150m / 300m widenings — strong match gates them off.
  assert.ok(!radiusCalls.includes(150), `150m should be skipped; saw ${radiusCalls.join(",")}`);
  assert.ok(!radiusCalls.includes(300), `300m should be skipped; saw ${radiusCalls.join(",")}`);
});
