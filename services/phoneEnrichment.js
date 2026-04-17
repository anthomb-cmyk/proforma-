// services/phoneEnrichment.js
//
// Phone enrichment pipeline for the "Recherche Tél" feature.
//
// Contract (kept backward-compatible with proforma-web/src/App.js):
//   runPhoneLookupBatch({ rows, apiKey, options }) -> { results: [...] }
// Each result has: { id, inputName, inputAddress, matchedName, matchedAddress,
//                    phone, inputPhones, website, source, confidence,
//                    status, statusLabel, candidates, searchedAt, trace }
//
// Design priorities — in this order:
//   1) Never produce false-positive matches (Hôtel de ville, shared public
//      numbers, Quebec numbered-company drift, cadastre/matricule as query).
//   2) Always surface phones already in the row, even if the online lookup
//      finds nothing (status=found if ANY valid phone exists).
//   3) Be transparent — each result carries a `trace` explaining what the
//      pipeline did / why it rejected candidates.
//
// This module has zero top-level side effects, so it's safely importable and
// test-friendly. Pass `fetchImpl` in options to override the network call
// (used by tests). Pass `apiKey` explicitly; the caller owns env handling.

/* ========================================================================== *
 *  Low-level text helpers
 * ========================================================================== */

const NON_ALNUM_RE = /[^a-z0-9]+/g;
const DIACRITIC_RE = /[\u0300-\u036f]/g;

export function cleanText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).replace(/\s+/g, " ").trim();
}

export function normalizeKey(v) {
  return cleanText(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_RE, "")
    .replace(NON_ALNUM_RE, " ")
    .trim();
}

export function tokens(v) {
  const n = normalizeKey(v);
  return n ? n.split(" ").filter(Boolean) : [];
}

// Jaccard over trigram sets - stable, cheap, good enough for short strings.
export function stringSim(a, b) {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const gram = (s) => {
    const pad = ` ${s} `;
    const set = new Set();
    for (let i = 0; i < pad.length - 2; i++) set.add(pad.slice(i, i + 3));
    return set;
  };
  const ga = gram(na);
  const gb = gram(nb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union ? inter / union : 0;
}

/* ========================================================================== *
 *  Phone normalization + extraction
 * ========================================================================== */

// Matches NANP-style phone numbers in free text. Deliberately broad — we parse
// candidates here and then let isValidNanpPhone decide which are real. That's
// simpler than trying to encode every rule in the regex.
const PHONE_RE =
  /(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/g;

// NANP service codes / fictional ranges that a real subscriber line can never
// use. The spec is in ATIS-0300051; the short version:
//   - Area code (NPA): first digit 2-9, NOT N11 (211/311/…/911 are services)
//   - Central office code (NXX): first digit 2-9, NOT N11, and the range 555
//     is reserved — only 555-01XX is safe for fictional use.
//   - Subscriber (XXXX): anything, but pure padding (0000, 9999) on top of a
//     garbage exchange reveals a non-phone.
//
// We also catch the common "this isn't a phone" tells: ≥7 identical digits in
// a row, or the whole number being a single repeated digit.

const N11_SUFFIX = new Set(["211", "311", "411", "511", "611", "711", "811", "911"]);
// NXX codes that the NANP reserves or never assigns to subscribers. We keep
// this narrow on purpose — real working area codes like 450/514/819 often have
// exchanges that look "round" (e.g. 222). The ones below are the exchanges
// that the NANPA specifically reserves for internal signalling / testing.
const RESERVED_NXX = new Set(["000", "999", "958", "959"]);

export function isValidNanpPhone(digits10) {
  if (!/^\d{10}$/.test(digits10)) return false;
  const npa = digits10.slice(0, 3);
  const nxx = digits10.slice(3, 6);
  const sub = digits10.slice(6, 10);
  // NPA rules
  if (npa[0] < "2") return false;            // area code can't start 0 or 1
  if (N11_SUFFIX.has(npa)) return false;     // N11 codes aren't area codes
  // NXX rules
  if (nxx[0] < "2") return false;            // exchange can't start 0 or 1
  if (N11_SUFFIX.has(nxx)) return false;     // 211/311/…/911 not an exchange
  if (RESERVED_NXX.has(nxx)) return false;   // 000/999/958/959 reserved
  if (nxx === "555" && !/^01\d\d$/.test(sub)) return false; // 555 fiction
  // Overall shape rules
  if (/^(\d)\1{9}$/.test(digits10)) return false;   // all same digit
  if (/(\d)\1{6,}/.test(digits10)) return false;    // 7+ identical in a row
  return true;
}

export function normalizePhoneKey(v) {
  const digits = String(v ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  let n = digits;
  // Strip a leading North-American country code (1).
  if (n.length >= 11 && n.startsWith("1")) n = n.slice(1);
  // Trailing junk past 10 digits (e.g. "ext 42") gets dropped.
  if (n.length > 10) n = n.slice(0, 10);
  if (n.length !== 10) return "";
  if (!isValidNanpPhone(n)) return "";
  return n;
}

export function formatPhone(v) {
  const k = normalizePhoneKey(v);
  if (!k) return cleanText(v);
  return `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}`;
}

// Extract *all* phone numbers appearing anywhere in a row's values.
// The row may already have been flattened (string values) or still be the raw
// object with any column types. We stringify defensively.
export function extractRowPhones(row) {
  const found = new Set();
  const out = [];
  const walk = (val) => {
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) return val.forEach(walk);
    if (typeof val === "object") return Object.values(val).forEach(walk);
    const s = String(val);
    PHONE_RE.lastIndex = 0;
    let m;
    while ((m = PHONE_RE.exec(s))) {
      const key = normalizePhoneKey(m[0]);
      if (!key || found.has(key)) continue;
      found.add(key);
      out.push(formatPhone(m[0]));
    }
  };
  walk(row);
  return out;
}

export function mergePhoneLists(...sources) {
  const seen = new Set();
  const out = [];
  const push = (v) => {
    const key = normalizePhoneKey(v);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(formatPhone(v));
  };
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src)) src.forEach(push);
    else push(src);
  }
  return out;
}

/* ========================================================================== *
 *  Row inference — pick the fields that matter for query building
 * ========================================================================== */

// Columns we KNOW encode non-query noise. The match is done on the normalized
// header key (lowercased, accent-stripped, non-alnum collapsed to spaces).
const HEADER_PATTERNS = {
  buildingAddress: [
    /\badresses? immeubles? clean\b/,
    /\badresse immeuble\b/,
    /\bbuilding address\b/,
  ],
  buildingAddressFallback: [
    /\badresse\b(?!.*postale)/,
    /\baddress\b/,
    /\bstreet\b/,
    /\brue\b/,
  ],
  cityBuilding: [/\bville\b/, /\bcity\b/, /\bmunicipalite\b/, /\bmunicipality\b/],
  postalBuilding: [/\bcode postal immeuble\b/, /\bcode postal\b/, /\bpostal code\b/, /\bzip\b/],
  province: [/\bprovince\b/, /\betat\b/, /\bstate\b/],
  ownerName: [
    /\bproprietaire\d+\s+nom\b/,
    /\bowner\s+name\b/,
    /\bnom\s+proprio\b/,
  ],
  ownerAddress: [
    // "Propriétaire1_Adresse_clean" normalized = "proprietaire1 adresse clean".
    /\bproprietaire\d+\s+adresse(?:\s+clean)?\b/,
    /\bowner\s+address\b/,
  ],
  ownerStatus: [
    // After normalizeKey, "Propriétaire1_StatutImpositionScolaire" collapses
    // to "proprietaire1 statutimpositionscolaire" — note no word boundary
    // between "statut" and "imposition" because camelCase is glued.
    /\bproprietaire\d+\s+statut/,
    /\bowner\s+type\b/,
    /^statut/,
  ],
  cadastre: [/\bcadastre\b/],
  matricule: [/\bmatricule\b/],
  contact: [/\bcontact\b/, /\bprenom\b/, /\bnom complet\b/],
  companyExplicit: [
    /\bcompagnie\b/,
    /\bentreprise\b/,
    /\braison sociale\b/,
    /\bsociete\b/,
    /\bbusiness name\b/,
    /\bnom entreprise\b/,
    /\bnom compagnie\b/,
  ],
};

function pickFirst(entries, patterns) {
  // Patterns are listed in priority order: the first pattern that matches any
  // entry wins over later patterns, even if a later pattern's matching entry
  // appears earlier in the column order.  This matters for e.g. preferring
  // "adresses immeubles clean" over the raw "Adresse Immeuble" column.
  for (const rx of patterns) {
    for (const entry of entries) {
      if (rx.test(entry.normKey) && entry.value) return entry;
    }
  }
  return null;
}

function pickAll(entries, patterns) {
  const out = [];
  for (const entry of entries) {
    if (patterns.some((rx) => rx.test(entry.normKey)) && entry.value) out.push(entry);
  }
  return out;
}

// Identity markers that mean "this cell is NOT a company/business name".
// Cadastre (usually 7 digits) / matricule (####-##-####-#-###-####) /
// Quebec numbered corporations (####-#### (Québec|Quebec) Inc).
const CADASTRE_RE = /^\d{6,8}$/;
const MATRICULE_RE = /^\d{4}-\d{2}-\d{4}-\d-\d{3}-\d{4}$/;
const NUMBERED_CORP_RE = /^\d{4}-\d{4}\s*(qu[eé]bec|canada)?\s*inc\.?$/i;
const MUNICIPAL_RE =
  /^(ville|municipalite|municipalit[eé]|mrc|regie|r[eé]gie|agglom[eé]ration|hotel de ville|h[oô]tel de ville)\b/i;

export function isJunkBusinessName(v) {
  const t = cleanText(v);
  if (!t) return true;
  if (CADASTRE_RE.test(t)) return true;
  if (MATRICULE_RE.test(t)) return true;
  if (NUMBERED_CORP_RE.test(t)) return true;
  if (MUNICIPAL_RE.test(t)) return true;
  // Pure numeric / separator garbage
  if (!/[a-z\u00c0-\u017f]/i.test(t)) return true;
  return false;
}

export function looksLikePersonalName(v) {
  const t = cleanText(v);
  if (!t) return false;
  // "Bourque, Mathieu" / "Mathieu Bourque" / "DANIEL BOISCLAIR"
  const n = normalizeKey(t);
  if (!n || /\d/.test(n)) return false;
  // Company hints override
  if (/\b(inc|ltee|ltd|llc|corp|corporation|compagnie|groupe|group|entreprise|services?|renovations?|construction|immobilier|realty|holdings|hotel|motel|restaurant|cafe|garage|clinique|pharmacie|cooperative|gestion|coop)\b/.test(n))
    return false;
  const w = n.split(" ").filter(Boolean);
  if (w.length < 2 || w.length > 4) return false;
  return w.every((word) => word.length >= 2 && word.length <= 24);
}

export function extractCivicNumber(address) {
  const t = cleanText(address);
  if (!t) return "";
  // Take the token before the first street word, e.g. "49 A-49 B Rue Yargeau".
  const head = t.split(",")[0];
  const m = head.match(/^\s*(\d{1,6})(?:[A-Za-z\-]?\d{0,6})?\b/);
  return m ? m[1] : "";
}

/* ========================================================================== *
 *  Row normalization
 * ========================================================================== */

export function normalizeRow(rawRow = {}) {
  const source =
    rawRow && typeof rawRow === "object" && rawRow.rawRow && typeof rawRow.rawRow === "object"
      ? rawRow.rawRow
      : rawRow;

  const entries = Object.entries(source || {})
    .map(([key, value]) => ({
      key,
      normKey: normalizeKey(key),
      value: cleanText(value),
    }))
    .filter((e) => e.value);

  const buildingAddress =
    pickFirst(entries, HEADER_PATTERNS.buildingAddress)?.value ||
    pickFirst(entries, HEADER_PATTERNS.buildingAddressFallback)?.value ||
    "";

  const city = pickFirst(entries, HEADER_PATTERNS.cityBuilding)?.value || "";
  const postal = pickFirst(entries, HEADER_PATTERNS.postalBuilding)?.value || "";
  const province = pickFirst(entries, HEADER_PATTERNS.province)?.value || "Qc";

  const ownerEntries = pickAll(entries, HEADER_PATTERNS.ownerName);
  const statusEntries = pickAll(entries, HEADER_PATTERNS.ownerStatus);
  const ownerAddressEntries = pickAll(entries, HEADER_PATTERNS.ownerAddress);

  // Pair owners with their status column by index (1,2,3,4...) when possible.
  const statusByIdx = new Map();
  for (const s of statusEntries) {
    const m = s.key.match(/(\d+)/);
    statusByIdx.set(m ? m[1] : "1", s.value);
  }

  const owners = [];
  for (const o of ownerEntries) {
    const idxMatch = o.key.match(/(\d+)/);
    const idx = idxMatch ? idxMatch[1] : "1";
    owners.push({
      raw: o.value,
      status: statusByIdx.get(idx) || "",
    });
  }

  // Build the list of candidate business-name queries, in priority order,
  // rejecting junk and personal-name owners.
  const businessNames = [];
  const rejectedOwners = [];

  const considerBusiness = (name, reasonIfRejected) => {
    const cleaned = cleanText(name);
    if (!cleaned) return;
    if (isJunkBusinessName(cleaned)) {
      rejectedOwners.push({ value: cleaned, reason: "junk" });
      return;
    }
    if (looksLikePersonalName(cleaned)) {
      rejectedOwners.push({ value: cleaned, reason: "personal_name" });
      return;
    }
    if (!businessNames.includes(cleaned)) businessNames.push(cleaned);
  };

  for (const owner of owners) {
    // If we KNOW it's an individual (Physique), never use the owner as a
    // business query. Morale = legal entity = OK to query (if not junk).
    if (/^physique$/i.test(owner.status)) {
      rejectedOwners.push({ value: owner.raw, reason: "owner_is_physique" });
      continue;
    }
    considerBusiness(owner.raw, "owner");
  }

  const explicitCompany = pickFirst(entries, HEADER_PATTERNS.companyExplicit)?.value;
  if (explicitCompany) considerBusiness(explicitCompany, "explicit");

  // Cadastre/matricule cells should never be used as queries regardless of
  // their header — additional defense in depth.
  const suppressed = pickAll(entries, [
    ...HEADER_PATTERNS.cadastre,
    ...HEADER_PATTERNS.matricule,
  ]);

  // Inferred building address of last resort: any entry that looks like a
  // civic-number + street word.
  let guessedAddress = "";
  if (!buildingAddress) {
    const guess = entries.find((e) =>
      /\d.*\b(rue|avenue|av|boulevard|blvd|chemin|route|street|st)\b/i.test(e.value),
    );
    guessedAddress = guess ? guess.value : "";
  }
  const finalBuildingAddress = buildingAddress || guessedAddress;

  // Collect owner mailing addresses (dedupe by normalized form; skip entries
  // that look like junk or aren't real addresses).
  const ownerAddresses = [];
  const seenOwnerAddr = new Set();
  for (const e of ownerAddressEntries) {
    const v = cleanText(e.value);
    if (!v) continue;
    // An address must contain at least one digit (civic number) and at least
    // one street-word hint. Otherwise skip to avoid mailing labels that are
    // purely a person's name.
    if (!/\d/.test(v)) continue;
    if (!/(rue|avenue|av|boulevard|blvd|chemin|route|street|st\b|road|rd\b|lane|ln\b|drive|dr\b)/i.test(v)) continue;
    const key = normalizeKey(v);
    if (!key || seenOwnerAddr.has(key)) continue;
    // Never re-query the building address as an owner address.
    if (key === normalizeKey(finalBuildingAddress)) continue;
    seenOwnerAddr.add(key);
    ownerAddresses.push(v);
  }

  // Inferred phones mined from every cell.
  const inputPhones = extractRowPhones(source);

  return {
    buildingAddress: finalBuildingAddress,
    city,
    province,
    postal,
    country: "Canada",
    businessNames,
    ownerAddresses,
    rejectedOwners,
    suppressed: suppressed.map((s) => ({ key: s.key, value: s.value })),
    civic: extractCivicNumber(finalBuildingAddress),
    inputPhones,
    raw: source,
  };
}

/* ========================================================================== *
 *  Query builder
 * ========================================================================== */

// Build the set of queries we will fire against Places for a normalized row.
// Contract: *never* build a query from municipality/city alone, *never*
// include the cadastre, *never* pass personal names.
export function buildQueries(norm) {
  const queries = [];
  const addr = norm.buildingAddress;
  const city = norm.city;
  const prov = norm.province;
  const postal = norm.postal;

  if (addr) {
    // Address-only query. City is helpful here because the address is tied to
    // a physical location. We DO NOT pass a business name in this query —
    // that's what caused drift before.
    const parts = [addr, city, prov, postal, norm.country].filter(Boolean);
    queries.push({
      type: "address",
      query: parts.join(", "),
      expectedAddress: addr,
      expectedCivic: norm.civic,
      expectedName: "",
    });
  }

  for (const name of norm.businessNames) {
    // Business-name query is intentionally PARTNERED with the address when we
    // have one (so Places disambiguates). If we have no address, we fall back
    // to name + city only — but NEVER city alone.
    const parts = [name, addr || null, city, prov].filter(Boolean);
    queries.push({
      type: "business",
      query: parts.join(", "),
      expectedAddress: addr,
      expectedCivic: norm.civic,
      expectedName: name,
    });
  }

  // Owner mailing addresses — the owner's business is often listed at their
  // own address (especially for Morale / gestion companies). We lookup each
  // one as an address query, gated by the owner address's own civic number.
  for (const ownerAddr of norm.ownerAddresses) {
    queries.push({
      type: "owner_address",
      query: ownerAddr,
      expectedAddress: ownerAddr,
      expectedCivic: extractCivicNumber(ownerAddr),
      expectedName: "",
    });
  }

  return queries;
}

/* ========================================================================== *
 *  Google Places client (injectable fetch for tests)
 * ========================================================================== */

const PLACES_TEXT_SEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json";
const PLACES_DETAIL_FIELDS =
  "name,formatted_address,formatted_phone_number,international_phone_number,website,business_status,types,place_id";

export function createPlacesClient({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY manquante.");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation required");

  async function textSearch(query) {
    const url = `${PLACES_TEXT_SEARCH_URL}?query=${encodeURIComponent(query)}&language=fr&region=ca&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const d = await r.json();
    if (d.status === "REQUEST_DENIED") {
      throw new Error(`Google Places: ${d.error_message || "REQUEST_DENIED"}`);
    }
    if (d.status === "OVER_QUERY_LIMIT") {
      throw new Error("Google Places: OVER_QUERY_LIMIT");
    }
    return Array.isArray(d.results) ? d.results : [];
  }

  async function details(placeId) {
    const url = `${PLACES_DETAILS_URL}?place_id=${encodeURIComponent(placeId)}&fields=${PLACES_DETAIL_FIELDS}&language=fr&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const d = await r.json();
    return d?.result || {};
  }

  return { textSearch, details };
}

/* ========================================================================== *
 *  Candidate scoring + matcher
 * ========================================================================== */

// Google Places type codes that are never valid business leads.
const BLOCKED_PLACE_TYPES = new Set([
  "city_hall",
  "local_government_office",
  "courthouse",
  "embassy",
  "post_office",
  "police",
  "fire_station",
  "locality",
  "political",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "continent",
  "natural_feature",
  "route",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
]);

function hasBlockedType(types) {
  if (!Array.isArray(types)) return false;
  return types.some((t) => BLOCKED_PLACE_TYPES.has(t));
}

// Score a single candidate against the row it came from. Returns
// { accepted, confidence, reason } where confidence is 0..100 and reason
// documents rejection when accepted=false.
export function scoreCandidate({ query, candidate }) {
  const reasons = [];
  if (hasBlockedType(candidate.types)) {
    return { accepted: false, confidence: 0, reason: `blocked_type:${candidate.types.join("|")}` };
  }
  if (candidate.business_status && candidate.business_status !== "OPERATIONAL") {
    return { accepted: false, confidence: 0, reason: `status:${candidate.business_status}` };
  }

  const addrSim = query.expectedAddress
    ? stringSim(query.expectedAddress, candidate.address)
    : null;

  const nameSim = query.expectedName
    ? stringSim(query.expectedName, candidate.name)
    : null;

  // CIVIC-NUMBER CHECK — fail closed. If we can parse a civic on either side,
  // they MUST match.
  const expectedCivic = query.expectedCivic || extractCivicNumber(query.expectedAddress);
  const candCivic = extractCivicNumber(candidate.address);
  let civicPass = true;
  if (expectedCivic && candCivic && expectedCivic !== candCivic) {
    return {
      accepted: false,
      confidence: 0,
      reason: `civic_mismatch:${expectedCivic}!=${candCivic}`,
    };
  }
  if (expectedCivic && !candCivic) {
    // Input had a civic number but Google result didn't — low trust.
    civicPass = false;
    reasons.push("candidate_missing_civic");
  }

  // Confidence model:
  //  - business query: 60% name sim + 40% address sim (default .2 floor)
  //  - address query: 100% address sim
  //  - bonus for civic match, penalty for missing civic
  let confidence;
  if (query.type === "business") {
    const ns = nameSim === null ? 0.2 : nameSim;
    const as = addrSim === null ? 0.2 : addrSim;
    confidence = 0.6 * ns + 0.4 * as;
  } else {
    confidence = addrSim === null ? 0 : addrSim;
  }
  if (expectedCivic && candCivic && expectedCivic === candCivic) {
    confidence += 0.15;
    reasons.push("civic_match_bonus");
  }
  if (!civicPass) {
    confidence -= 0.2;
  }
  confidence = Math.max(0, Math.min(1, confidence));
  const pct = Math.round(confidence * 100);

  // Acceptance threshold. Higher for business queries; address queries need
  // a civic match to be trusted.
  if (query.type === "business") {
    const minName = nameSim !== null ? nameSim : 0;
    if (minName < 0.2 && (addrSim ?? 0) < 0.4) {
      return {
        accepted: false,
        confidence: pct,
        reason: `low_sim:name=${(nameSim ?? 0).toFixed(2)},addr=${(addrSim ?? 0).toFixed(2)}`,
      };
    }
    if (pct < 35) return { accepted: false, confidence: pct, reason: `low_confidence:${pct}` };
  } else {
    // address query
    if (!expectedCivic) {
      return { accepted: false, confidence: pct, reason: "address_query_requires_civic" };
    }
    if (!candCivic) {
      return { accepted: false, confidence: pct, reason: "result_missing_civic" };
    }
    if ((addrSim ?? 0) < 0.3) {
      return { accepted: false, confidence: pct, reason: `low_addr_sim:${(addrSim ?? 0).toFixed(2)}` };
    }
  }

  return { accepted: true, confidence: pct, reason: reasons.join(",") || "ok" };
}

/* ========================================================================== *
 *  Batch orchestrator
 * ========================================================================== */

function flattenPlaceResult(raw, detail) {
  return {
    placeId: raw.place_id || detail.place_id || "",
    name: cleanText(detail.name || raw.name || ""),
    address: cleanText(detail.formatted_address || raw.formatted_address || ""),
    phone: cleanText(detail.formatted_phone_number || detail.international_phone_number || ""),
    website: cleanText(detail.website || ""),
    types: Array.isArray(detail.types) ? detail.types : Array.isArray(raw.types) ? raw.types : [],
    business_status: detail.business_status || raw.business_status || "",
  };
}

// Global phone-frequency cap. If the SAME phone number shows up on > cap
// distinct building addresses in a single batch, it's almost certainly a
// public/shared number. Remove it from every row that relied on it ONLINE,
// but keep it if the row already had it in its file columns (`inputPhones`).
export function applyGlobalPhoneCap(results, cap) {
  if (!cap || cap <= 0) return results;
  const addressesByPhone = new Map();
  for (const r of results) {
    for (const p of r.onlinePhones || []) {
      const k = normalizePhoneKey(p);
      if (!k) continue;
      if (!addressesByPhone.has(k)) addressesByPhone.set(k, new Set());
      addressesByPhone.get(k).add(normalizeKey(r.inputAddress));
    }
  }
  const blacklisted = new Set();
  for (const [k, addrs] of addressesByPhone) {
    if (addrs.size > cap) blacklisted.add(k);
  }
  if (!blacklisted.size) return results;

  return results.map((r) => {
    const kept = [];
    const dropped = [];
    for (const p of r.onlinePhones || []) {
      const k = normalizePhoneKey(p);
      if (k && blacklisted.has(k)) dropped.push(p);
      else kept.push(p);
    }
    if (!dropped.length) return r;
    // Rebuild from the file-only phones (fileInputPhones) + surviving online
    // phones. Using r.inputPhones here would be a bug: it already contains
    // the blacklisted online number and would silently re-admit it.
    const rebuiltPhones = mergePhoneLists(r.fileInputPhones, kept);
    const trace = [
      ...(r.trace || []),
      `frequency_cap_dropped:${dropped.join(",")}`,
    ];
    const status = rebuiltPhones.length ? "found" : "not_found";
    return {
      ...r,
      onlinePhones: kept,
      phone: rebuiltPhones[0] || "",
      inputPhones: rebuiltPhones,
      status,
      statusLabel: status === "found" ? "Trouvé" : "Non trouvé",
      matchedName: kept.length ? r.matchedName : "",
      matchedAddress: kept.length ? r.matchedAddress : "",
      website: kept.length ? r.website : "",
      confidence: kept.length ? r.confidence : 0,
      trace,
    };
  });
}

async function lookupOneRow({ rawRow, client, opts, idFactory }) {
  const id = idFactory();
  const norm = normalizeRow(rawRow);
  const trace = [];
  const fileInputPhones = norm.inputPhones;

  if (fileInputPhones.length)
    trace.push(`file_phones:${fileInputPhones.length}`);
  if (norm.rejectedOwners.length) {
    for (const r of norm.rejectedOwners) {
      trace.push(`rejected_owner[${r.reason}]:${cleanText(r.value).slice(0, 40)}`);
    }
  }
  if (norm.suppressed.length) {
    for (const s of norm.suppressed) trace.push(`suppressed_cell:${s.key}`);
  }
  if (!norm.civic && norm.buildingAddress) {
    trace.push("warn_no_civic_parsed");
  }

  const queries = buildQueries(norm);
  if (!queries.length) {
    trace.push("no_queries_built");
  } else {
    for (const q of queries) trace.push(`query[${q.type}]:${q.query}`);
  }

  const accepted = [];
  const rejected = [];

  if (client && queries.length) {
    // Fire queries serially — Places gets angry with bursts, and the caller
    // already parallelizes across rows with a concurrency limit.
    for (const q of queries) {
      let results;
      try {
        results = await client.textSearch(q.query);
      } catch (err) {
        trace.push(`error[${q.type}]:${err.message || String(err)}`);
        continue;
      }
      const top = results.slice(0, opts.topN);
      for (const raw of top) {
        let detail = {};
        try {
          detail = raw.place_id ? await client.details(raw.place_id) : {};
        } catch (err) {
          trace.push(`details_error:${err.message || String(err)}`);
        }
        const flat = flattenPlaceResult(raw, detail);
        const score = scoreCandidate({ query: q, candidate: flat });
        const enriched = {
          ...flat,
          confidence: score.confidence,
          queryType: q.type,
        };
        if (score.accepted) accepted.push(enriched);
        else rejected.push({ ...enriched, reason: score.reason });
      }
    }
  }

  // Dedupe accepted candidates by placeId (or name+address fallback), keep
  // highest confidence.
  const byKey = new Map();
  for (const c of accepted) {
    const key = c.placeId || `${normalizeKey(c.name)}|${normalizeKey(c.address)}`;
    const prev = byKey.get(key);
    if (!prev || c.confidence > prev.confidence) byKey.set(key, c);
  }
  const ranked = [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
  const online = ranked.filter((c) => normalizePhoneKey(c.phone));
  const best = online[0] || ranked[0] || null;

  const onlinePhones = mergePhoneLists(online.map((c) => c.phone));
  const allPhones = mergePhoneLists(fileInputPhones, onlinePhones);
  const status = allPhones.length ? "found" : "not_found";

  return {
    id,
    inputName: norm.businessNames[0] || "",
    inputAddress: norm.buildingAddress,
    matchedName: online.length ? best?.name || "" : "",
    matchedAddress: online.length ? best?.address || "" : "",
    phone: allPhones[0] || "",
    inputPhones: allPhones,
    onlinePhones,
    fileInputPhones,
    website: online.length ? best?.website || "" : "",
    source: "google_places",
    confidence: online.length ? Number(best?.confidence || 0) : 0,
    status,
    statusLabel: status === "found" ? "Trouvé" : "Non trouvé",
    candidates: ranked
      .filter((c) => c !== best)
      .slice(0, 4)
      .map((c) => ({
        name: c.name,
        address: c.address,
        phone: c.phone,
        website: c.website,
        confidence: c.confidence,
      })),
    rejectedCandidates: rejected.slice(0, 8).map((c) => ({
      name: c.name,
      address: c.address,
      reason: c.reason,
      queryType: c.queryType,
    })),
    trace,
    searchedAt: new Date().toISOString(),
  };
}

function defaultIdFactory() {
  let i = 0;
  return () => `pl_${Date.now()}_${(i++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

// Main entry point.
export async function runPhoneLookupBatch({
  rows,
  apiKey,
  options = {},
} = {}) {
  const opts = {
    topN: options.topN ?? 3,
    perRowDelayMs: options.perRowDelayMs ?? 80,
    globalPhoneCap: options.globalPhoneCap ?? 3,
    maxRows: options.maxRows ?? 50,
    fetchImpl: options.fetchImpl,
    offline: options.offline === true || !apiKey,
  };

  if (!Array.isArray(rows) || !rows.length) {
    return { results: [] };
  }
  const capped = rows.slice(0, opts.maxRows);

  const client = opts.offline
    ? null
    : createPlacesClient({ apiKey, fetchImpl: opts.fetchImpl });

  const idFactory = defaultIdFactory();
  const results = [];
  for (const rawRow of capped) {
    const r = await lookupOneRow({ rawRow, client, opts, idFactory });
    results.push(r);
    if (opts.perRowDelayMs > 0 && client) {
      await new Promise((resolve) => setTimeout(resolve, opts.perRowDelayMs));
    }
  }

  const finalResults = applyGlobalPhoneCap(results, opts.globalPhoneCap);
  return { results: finalResults };
}

export const __testables__ = {
  CADASTRE_RE,
  MATRICULE_RE,
  NUMBERED_CORP_RE,
  MUNICIPAL_RE,
  BLOCKED_PLACE_TYPES,
  PHONE_RE,
  flattenPlaceResult,
};
