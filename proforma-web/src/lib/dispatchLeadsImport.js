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

// Inspect the CSV header row and return a { field → raw-header } map.
// Missing fields are simply absent from the returned object.
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

// End-to-end CSV → array<lead-like>. Returns { headers, headerMap, rows }
// so the caller can report on header detection (handy for debugging when
// the CSV uses unfamiliar column names).
export function parseDispatchLeadsCsv(text) {
  const parsed = parseCSV(text);
  const headerMap = detectHeaders(parsed.headers || []);
  const rows = (parsed.rows || []).map((r) => dispatchRowToLeadLike(r, headerMap));
  return { headers: parsed.headers || [], headerMap, rows };
}
