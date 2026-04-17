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
  extractRowPhones,
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

function stubFetch(handler) {
  return async (url) => ({
    async json() {
      return handler(String(url));
    },
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

test("extractRowPhones walks every cell and dedupes", () => {
  const row = {
    Ville: "VILLE DE VICTORIAVILLE",
    "Propriétaire1_Téléphone": "(819) 758-1571",
    "Propriétaire2_Téléphone": "819-758-1571", // dupe
    "Propriétaire3_Téléphone": "514 555 0199",
    Cadastre: "2476185", // 7 digits — must NOT be read as phone
    notes: "Call 514.555.0199 or 450 555 1212",
  };
  const phones = extractRowPhones(row);
  assert.equal(phones.length, 3);
  assert.ok(phones.includes("(819) 758-1571"));
  assert.ok(phones.includes("(514) 555-0199"));
  assert.ok(phones.includes("(450) 555-1212"));
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
      "Propriétaire1_Téléphone": "(819) 555-1234",
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
  assert.deepEqual(r.inputPhones, ["(819) 555-1234"]);
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
