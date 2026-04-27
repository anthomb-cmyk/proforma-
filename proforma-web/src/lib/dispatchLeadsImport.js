// proforma-web/src/lib/dispatchLeadsImport.js
//
// Read a Dispatch-style leads CSV (one row per lead) and convert each row
// into the lead-like shape that buildSearchPackages() consumes. Header
// detection is permissive: the same column can be named in French or
// English, snake_case or whatever Dispatch picks per export.
//
// Shape produced per row mirrors the Lead-like input shape documented in
// searchPackage.js:
//   {
//     companyName, contactName, address, city, postalCode,
//     mailing_address, mailing_city, mailing_province, mailing_postal_code,
//     units, phone, phones, email, website, status,
//     candidatePhones, candidateEmails, candidateWebsites,
//   }
//
// Owner phones tag with relationship_to_lead_owner = "owner".
// Building phones (separate column) tag with "building" so the audit can
// catch packages whose only file phone is a front-desk line.
//
// Pure / zero-network / no I/O. CSV parsing reuses parseCSV from
// tableImport.js — same delimiter detection (semicolon-first for French
// Excel exports) used everywhere else in the app.

import { parseCSV } from "./tableImport.js";
import { normalizeTextKey } from "./phoneUtils.js";
import {
  makePhoneCandidate,
  makeEmailCandidate,
  makeWebsiteCandidate,
} from "./contactCandidates.js";

// Normalize a header for fuzzy lookup — collapses accents, lowercases,
// reduces whitespace + punctuation to single underscores.
function normHeader(h) {
  return normalizeTextKey(h).replace(/\s+/g, "_");
}

// Field → candidate header names, listed in priority order. The first
// candidate that matches a header in the CSV wins. Names are normalized
// before comparison, so capitalization, accents, and separator choice
// don't matter (e.g. "Téléphone Propriétaire" / "telephone-proprietaire" /
// "TELEPHONE_PROPRIETAIRE" all collapse to "telephone_proprietaire").
const HEADER_CANDIDATES = {
  lead_owner_name: [
    "lead_owner_name", "owner_name", "owner", "display_name",
    "proprietaire", "nom_proprietaire", "nom_owner", "nom",
  ],
  status: [
    "status", "legal_entity_category", "category", "entity_type",
    "statut", "statut_aux_fins_d_imposition_scolaire",
  ],
  mailing_street: [
    "mailing_address", "mailing_street", "adresse_postale",
    "postal_address", "owner_address", "owner_street",
  ],
  mailing_city: [
    "mailing_city", "ville_postale", "owner_city",
    "owner_ville", "ville_proprietaire",
  ],
  mailing_province: [
    "mailing_province", "province_postale", "owner_province",
  ],
  mailing_postal_code: [
    "mailing_postal_code", "code_postal_postal", "cp_postal",
    "owner_postal_code", "code_postal_proprietaire", "cp_proprietaire",
  ],
  property_address: [
    "property_address", "building_address", "adresse_immeuble",
    "address", "adresse",
  ],
  property_city: [
    "property_city", "building_city", "ville_immeuble", "ville", "city",
  ],
  property_postal_code: [
    "property_postal_code", "building_postal_code",
    "code_postal_immeuble", "code_postal", "postal_code",
  ],
  units: [
    "units", "nb_logements", "logements", "nb_total_unites",
    "total_unites", "nb_unites", "doors",
  ],
  matricule: [
    "matricule", "numero_de_matricule", "numero_matricule",
  ],
  utilisation: [
    "utilisation", "utilisation_predominante", "use", "usage",
    "property_type", "type_immeuble",
  ],
  // Owner-direct phone (the one that reaches the actual owner).
  owner_phone: [
    "owner_phone", "telephone_proprietaire", "tel_proprietaire",
    "phone", "telephone", "tel",
  ],
  // Building / front-desk / superintendent phone — flagged separately so
  // the audit can spot packages whose only file phone is this one.
  building_phone: [
    "building_phone", "bldg_phone", "telephone_immeuble",
    "tel_immeuble", "phone_immeuble", "front_desk_phone",
  ],
  owner_email: [
    "owner_email", "courriel_proprietaire", "email_proprietaire",
    "email", "courriel",
  ],
  building_email: [
    "building_email", "courriel_immeuble", "email_immeuble",
  ],
  website: [
    "website", "site_web", "site_internet", "web_site", "url", "web",
  ],
};

// Per-owner fields. When the CSV ships multiple owner slots
// (Propriétaire / Propriétaire 2 / Propriétaire 3, …), these are the columns
// that vary between slots. Row-level fields (property_address, units,
// building_phone, …) stay shared across every owner emitted from that row.
const PER_OWNER_FIELDS = new Set([
  "lead_owner_name", "status",
  "mailing_street", "mailing_city", "mailing_province", "mailing_postal_code",
  "owner_phone", "owner_email", "website",
]);

// Match a header against the candidate list, allowing an optional numeric
// slot suffix ("Propriétaire 2", "lead_owner_name_3", "tel proprietaire 4").
// Returns { field, slot } when a match is found, else null. Slot 1 is the
// unsuffixed/no-suffix-or-suffix=1 case.
function classifyHeader(rawHeader) {
  const norm = normHeader(rawHeader);
  if (!norm) return null;
  // Strip a trailing _<digits> if present.
  let base = norm;
  let slot = 1;
  const m = norm.match(/^(.+?)_(\d+)$/);
  if (m) {
    base = m[1].replace(/_+$/, "");
    slot = Number(m[2]) || 1;
  }
  for (const [field, candidates] of Object.entries(HEADER_CANDIDATES)) {
    for (const cand of candidates) {
      if (normHeader(cand) === base) return { field, slot };
    }
  }
  return null;
}

// Detect every owner slot present in the CSV. Returns the slot indices
// found (sorted), e.g. [1] for a single-owner CSV, [1, 2, 3] for a
// multi-slot rôle-style CSV. The slot list is anchored on lead_owner_name —
// other per-owner fields (mailing_*, owner_phone, ...) attach to the same
// slot but only matter if the slot has a name column.
export function detectOwnerSlots(headers) {
  const slots = new Set();
  for (const h of (Array.isArray(headers) ? headers : [])) {
    const c = classifyHeader(h);
    if (c && c.field === "lead_owner_name") slots.add(c.slot);
  }
  return [...slots].sort((a, b) => a - b);
}

// Build a per-slot headerMap. Per-owner fields are looked up at the requested
// slot; row-level fields are inherited from slot 1 (the row-level columns are
// shared across every owner).
export function detectHeadersForSlot(headers, slot = 1) {
  const indexed = (Array.isArray(headers) ? headers : [])
    .map((h) => ({ raw: h, info: classifyHeader(h) }));
  const used = new Set();
  const map = {};
  for (const field of Object.keys(HEADER_CANDIDATES)) {
    const wantedSlot = PER_OWNER_FIELDS.has(field) ? slot : 1;
    const hit = indexed.find((h) =>
      h.info && h.info.field === field && h.info.slot === wantedSlot && !used.has(h.raw)
    );
    if (hit) {
      map[field] = hit.raw;
      used.add(hit.raw);
    }
  }
  return map;
}

// Inspect the CSV header row and return a { field → raw-header } map.
// Missing fields are simply absent from the returned object.
//
// This is the single-slot view of the headers (slot 1). Use detectOwnerSlots
// + detectHeadersForSlot for multi-slot CSVs.
export function detectHeaders(headers) {
  const list = Array.isArray(headers) ? headers : [];
  const indexed = list.map((h) => ({ raw: h, norm: normHeader(h) }));
  const used = new Set();
  const map = {};
  for (const [field, candidates] of Object.entries(HEADER_CANDIDATES)) {
    for (const cand of candidates) {
      const candNorm = normHeader(cand);
      const hit = indexed.find((h) => !used.has(h.raw) && h.norm === candNorm);
      if (hit) {
        map[field] = hit.raw;
        used.add(hit.raw);
        break;
      }
    }
  }
  return map;
}

function pickFromRow(row, headerMap, field) {
  const col = headerMap[field];
  if (!col) return "";
  const v = row?.[col];
  return v == null ? "" : String(v).trim();
}

// Convert one Dispatch CSV row into a lead-like record. headerMap is the
// output of detectHeaders(headers).
//
// Columns the function honors when the headerMap exposes them:
//   • lead_owner_name → companyName / contactName fallback
//   • mailing_*       → mailing identity used by buildSearchPackages
//   • property_*      → building/lead address (mapped to address/city/postalCode)
//   • owner_phone     → file candidate, relationship "owner"
//   • building_phone  → file candidate, relationship "building"
//   • owner_email / building_email / website → respective file candidates
//   • units / matricule / utilisation → carried through onto the row
//   • status          → passed to classifyLegalEntity downstream
export function dispatchRowToLeadLike(row, headerMap = {}) {
  const ownerName = pickFromRow(row, headerMap, "lead_owner_name");
  const ownerPhone = pickFromRow(row, headerMap, "owner_phone");
  const buildingPhone = pickFromRow(row, headerMap, "building_phone");
  const ownerEmail = pickFromRow(row, headerMap, "owner_email");
  const buildingEmail = pickFromRow(row, headerMap, "building_email");
  const website = pickFromRow(row, headerMap, "website");

  const candidatePhones = [];
  const ownerPhoneCol = headerMap.owner_phone || "owner_phone";
  const buildingPhoneCol = headerMap.building_phone || "building_phone";
  if (ownerPhone) {
    const c = makePhoneCandidate({
      phone: ownerPhone,
      source: "file",
      source_column: ownerPhoneCol,
      phone_owner_name: ownerName,
      relationship_to_lead_owner: "owner",
      evidence: `Dispatch CSV column "${ownerPhoneCol}"`,
    });
    if (c) candidatePhones.push(c);
  }
  if (buildingPhone) {
    const c = makePhoneCandidate({
      phone: buildingPhone,
      source: "file",
      source_column: buildingPhoneCol,
      relationship_to_lead_owner: "building",
      evidence: `Dispatch CSV column "${buildingPhoneCol}"`,
    });
    if (c) candidatePhones.push(c);
  }

  const candidateEmails = [];
  if (ownerEmail) {
    const c = makeEmailCandidate({
      email: ownerEmail,
      source: "file",
      source_column: headerMap.owner_email || "owner_email",
      email_owner_name: ownerName,
      relationship_to_lead_owner: "owner",
      evidence: `Dispatch CSV column "${headerMap.owner_email || "owner_email"}"`,
    });
    if (c) candidateEmails.push(c);
  }
  if (buildingEmail) {
    const c = makeEmailCandidate({
      email: buildingEmail,
      source: "file",
      source_column: headerMap.building_email || "building_email",
      relationship_to_lead_owner: "building",
      evidence: `Dispatch CSV column "${headerMap.building_email || "building_email"}"`,
    });
    if (c) candidateEmails.push(c);
  }

  const candidateWebsites = [];
  if (website) {
    const c = makeWebsiteCandidate({
      website,
      source: "file",
      source_column: headerMap.website || "website",
      relationship_to_lead_owner: "owner",
      evidence: `Dispatch CSV column "${headerMap.website || "website"}"`,
    });
    if (c) candidateWebsites.push(c);
  }

  // Lead-like input — buildSearchPackages's extractIdentity prefers
  // mailing_* fields when present, else falls back to address/city/postalCode.
  // We pass BOTH mailing and property pieces so the mailing identity drives
  // the grouping while the property-level pieces become associated_properties.
  const phonesFlat = [ownerPhone, buildingPhone].filter(Boolean);
  return {
    companyName: ownerName,
    contactName: "",
    address: pickFromRow(row, headerMap, "property_address"),
    city: pickFromRow(row, headerMap, "property_city"),
    postalCode: pickFromRow(row, headerMap, "property_postal_code"),
    mailing_address: pickFromRow(row, headerMap, "mailing_street"),
    mailing_city: pickFromRow(row, headerMap, "mailing_city"),
    mailing_province: pickFromRow(row, headerMap, "mailing_province"),
    mailing_postal_code: pickFromRow(row, headerMap, "mailing_postal_code"),
    units: parseInt(pickFromRow(row, headerMap, "units"), 10) || 0,
    matricule: pickFromRow(row, headerMap, "matricule"),
    utilisation: pickFromRow(row, headerMap, "utilisation"),
    phone: ownerPhone,
    phones: phonesFlat,
    email: ownerEmail,
    website,
    status: pickFromRow(row, headerMap, "status"),
    candidatePhones,
    candidateEmails,
    candidateWebsites,
  };
}

// End-to-end CSV → array<lead-like>. Returns { headers, headerMap, slots, rows }.
//
// MULTI-OWNER FAN-OUT: when the CSV exposes multiple owner slots
// (Propriétaire / Propriétaire 2 / Propriétaire 3, …), each CSV row is
// fanned out into one lead-like record per non-empty owner slot. Each
// emitted record carries:
//   • the slot's own name + mailing + owner_phone + owner_email
//   • the row-level property/building fields (shared across all slots)
//   • aliases listing every OTHER non-empty owner name on the same row,
//     so buildSearchPackages can preserve them as co_owners
//
// Single-slot CSVs (the current Dispatch output) emit one record per CSV
// row exactly as before — behavior unchanged.
//
// `headerMap` is the slot-1 view of the headers (kept for backward compat
// with callers that don't care about slots). `slots` is the list of slot
// indices found in the CSV (e.g. [1, 2, 3]).
export function parseDispatchLeadsCsv(text) {
  const parsed = parseCSV(text);
  const headers = parsed.headers || [];
  const csvRows = parsed.rows || [];
  const slots = detectOwnerSlots(headers);
  const slotMaps = (slots.length ? slots : [1]).map((s) => ({
    slot: s,
    map: detectHeadersForSlot(headers, s),
  }));
  const headerMap = slotMaps[0]?.map || {};

  const rows = [];
  for (const r of csvRows) {
    // Resolve every non-empty slot for this row. We need this twice: once
    // to know which names exist (for the co-owner aliases on each emit),
    // and once to actually emit the lead-like records.
    const presentSlots = slotMaps
      .map(({ slot, map }) => {
        const name = String(r?.[map.lead_owner_name] || "").trim();
        return name ? { slot, map, name } : null;
      })
      .filter(Boolean);
    if (!presentSlots.length) continue;
    for (const { slot, map, name } of presentSlots) {
      const coOwnerNames = presentSlots
        .filter((p) => p.slot !== slot)
        .map((p) => p.name);
      const lead = dispatchRowToLeadLike(r, map);
      if (coOwnerNames.length) {
        // buildSearchPackages collects co_owners from contactNames + aliases
        // (excluding the chosen lead_owner_name). Push co-owners into aliases
        // so they show up regardless of person/company classification.
        lead.aliases = [...(lead.aliases || []), ...coOwnerNames];
      }
      rows.push(lead);
    }
  }
  return { headers, headerMap, slots: slots.length ? slots : [1], rows };
}
