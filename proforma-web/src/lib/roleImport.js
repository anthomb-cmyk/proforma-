// proforma-web/src/lib/roleImport.js
//
// Parse the "wide" Québec rôle d'évaluation XLSX format — one row per
// property, up to 8 owner slots per row. Dedups owners by their mailing
// postal address (one Owner per unique `Adresse postale`) and emits
// Owner + Lead records shaped to flow through the existing App state.
//
// The rôle XLSX has three column groups, always in this order:
//
//   1. Property-level (civic) — Ville, Adresse Immeuble, Numéro de matricule,
//      Utilisation prédominante, ...
//   2. Owner slots — 8 slots × 6 columns each. Slot 0 uses unsuffixed column
//      names (Propriétaire, Propriétaire Prénom, Propriétaire Nom, Statut
//      aux fins d'imposition scolaire, Adresse postale, Téléphone); slot N
//      suffixes everything with " N" (e.g. "Propriétaire 2", "Adresse
//      postale 2", "Téléphone 2").
//   3. Property detail — Valeur de l'immeuble, Année de construction, Lat,
//      Lon, Nb Propriétaires, Téléphone Immeuble, ...
//
// We find columns by normalized header name (strip accents + lowercase,
// substring match) — identical convention to ownerGrouping.js
// `normalizeHeaderKey`. Column *positions* in the sheet are not trusted;
// the Longueuil exports have shifted by ±1 column between revisions.
//
// Public API:
//   parseRoleXlsx(file) → Promise<{ properties, ownersMap, stats }>
//   buildOwnersAndLeadsFromRole(parsed, existingOwners) →
//       { newOwners, updatedOwners, allOwners, leads }

import { parseSpreadsheet } from "./tableImport.js";
import { ownerKey as buildOwnerKey, normalizeStreet, normalizePostal } from "./ownerKey.js";
import { mergeOwners } from "./ownerGrouping.js";
import { normalizePhoneKey, mergePhoneLists } from "./phoneUtils.js";
import {
  makePhoneCandidate,
  makeEmailCandidate,
  makeWebsiteCandidate,
  mergePhoneCandidates,
  mergeEmailCandidates,
  mergeWebsiteCandidates,
  flattenPhoneCandidates,
  flattenEmailCandidates,
  flattenWebsiteCandidates,
  pickBestPhone,
  pickBestEmail,
  pickBestWebsite,
  extractEmailsFromText,
  extractWebsitesFromText,
} from "./contactCandidates.js";

// Mirrors ownerGrouping.js — keep the two aligned so a header that matches
// in one place matches in the other. Strips accents, lowercases, collapses
// underscores/hyphens/whitespace to single spaces, trims.
export function normalizeHeaderKey(key) {
  return String(key || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Find the first header whose normalized form EQUALS `target` (normalized).
// Exact-match because the rôle exports use stable column names — we don't
// want "Adresse postale" accidentally matching "Adresse postale 2".
function findExactHeader(headers, target) {
  const want = normalizeHeaderKey(target);
  for (const h of headers || []) {
    if (normalizeHeaderKey(h) === want) return h;
  }
  return "";
}

// Find the first header whose normalized form CONTAINS all of the given
// substrings (normalized). Used for more forgiving matches on property-
// detail columns that sometimes carry trailing notes like
// "Valeur de l'immeuble au rôle antérieur".
function findContainsHeader(headers, ...parts) {
  const needles = parts.map(normalizeHeaderKey).filter(Boolean);
  if (!needles.length) return "";
  for (const h of headers || []) {
    const n = normalizeHeaderKey(h);
    if (needles.every(needle => n.includes(needle))) return h;
  }
  return "";
}

// Parse a civic address string out of the "Adresse postale" column. The
// column mixes street + city + postal: "1234 rue Main, Longueuil (Québec)
// J4K 1A1". We split on the last comma-separated token that looks like a
// Canadian postal code (A1A 1A1) and keep everything before that as the
// street. City is the token before the postal. Province is everything in
// parens.
//
// Returns { street, city, province, postalCode }. Missing fields → "".
export function parsePostalAddress(raw) {
  const s = String(raw || "").trim();
  if (!s) return { street: "", city: "", province: "", postalCode: "" };

  // Extract postal code (A1A 1A1 — allow optional space).
  const postalMatch = s.match(/([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$/);
  const postalCode = postalMatch ? postalMatch[1].trim() : "";
  let remainder = postalCode ? s.slice(0, s.length - postalMatch[0].length).trim() : s;
  // Drop trailing comma if the postal was comma-separated.
  remainder = remainder.replace(/[,\s]+$/, "");

  // Extract province in parens — "(Québec)" / "(Quebec)" / "(QC)".
  let province = "";
  const provMatch = remainder.match(/\(([^)]+)\)\s*$/);
  if (provMatch) {
    province = provMatch[1].trim();
    remainder = remainder.slice(0, remainder.length - provMatch[0].length).trim().replace(/[,\s]+$/, "");
  }

  // Split remaining "street, city" on the LAST comma — street may legally
  // contain commas ("100, rue Saint-Jacques").
  let street = remainder;
  let city = "";
  const lastComma = remainder.lastIndexOf(",");
  if (lastComma >= 0) {
    street = remainder.slice(0, lastComma).trim();
    city = remainder.slice(lastComma + 1).trim();
  }

  return { street, city, province, postalCode };
}

// Pull every NANP-valid phone out of a value. The rôle's Téléphone column
// sometimes carries multiple numbers separated by " / ", ";", or " et ".
// Returns a deduped array of display-formatted strings.
function extractPhones(value) {
  return mergePhoneLists(value);
}

// Parse a numeric cell value — strips $, spaces, commas — returns Number
// or undefined for non-numeric input. Used on Valeur/Superficie/Année
// columns.
function toNumber(value) {
  const s = String(value || "").replace(/[\s$,]/g, "").replace(/\u00a0/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Detect all 8 owner-slot column sets in the sheet. Returns an array of
// slot descriptors, one per slot that actually exists in the headers.
// We key off the base "Propriétaire" name column: slot 0 is the
// unsuffixed one; slots 1..7 use " 2", " 3", ..., " 8" suffixes.
//
// Phones / emails / websites are also picked up if the export carries them.
// Standard rôles only ship a "Téléphone" column, but municipalities have
// started adding "Courriel" and "Site web" columns sporadically — we prefer
// to detect them up-front rather than miss the data when it shows up.
function findOwnerSlotColumns(headers) {
  const slots = [];
  // Slot indices 0..7, 0 uses no suffix, 1 uses " 2", 2 uses " 3", etc.
  // The rôle column header is literally "Propriétaire" for slot 0 and
  // "Propriétaire N" for slot N.
  for (let idx = 0; idx < 8; idx++) {
    const suffix = idx === 0 ? "" : ` ${idx + 1}`;
    const nameCol = findExactHeader(headers, `Propriétaire${suffix}`);
    if (!nameCol) continue;
    const phoneSuffix = idx === 0 ? "" : ` ${idx + 1}`;
    slots.push({
      idx,
      nameCol,
      firstNameCol: findExactHeader(headers, `Propriétaire${suffix} Prénom`),
      lastNameCol: findExactHeader(headers, `Propriétaire${suffix} Nom`),
      statusCol: findExactHeader(headers, `Statut aux fins d'imposition scolaire${suffix}`),
      addressCol: findExactHeader(headers, `Adresse postale${suffix}`),
      phoneCol: findExactHeader(headers, `Téléphone${phoneSuffix}`),
      emailCol:
        findExactHeader(headers, `Courriel${suffix}`) ||
        findExactHeader(headers, `Email${suffix}`) ||
        findExactHeader(headers, `Courriel Propriétaire${suffix}`) ||
        findExactHeader(headers, `Email Propriétaire${suffix}`),
      websiteCol:
        findExactHeader(headers, `Site web${suffix}`) ||
        findExactHeader(headers, `Site Web${suffix}`) ||
        findExactHeader(headers, `Website${suffix}`) ||
        findExactHeader(headers, `Site web Propriétaire${suffix}`),
    });
  }
  return slots;
}

// Extract a single owner slot's data from a row. Returns null if the
// base name column is empty (slot not present on this row).
//
// For each contact column we record BOTH the deduped value list (for
// backwards-compat with the existing flat phones array) AND a list of full
// candidate objects with source-column attribution. Downstream code merges
// the candidate lists across slots / properties / re-imports.
function extractOwnerSlot(row, slot) {
  const name = String(row[slot.nameCol] || "").trim();
  if (!name) return null;
  const firstName = slot.firstNameCol ? String(row[slot.firstNameCol] || "").trim() : "";
  const lastName = slot.lastNameCol ? String(row[slot.lastNameCol] || "").trim() : "";
  const status = slot.statusCol ? String(row[slot.statusCol] || "").trim() : "";
  const postalRaw = slot.addressCol ? String(row[slot.addressCol] || "").trim() : "";
  const phoneRaw = slot.phoneCol ? String(row[slot.phoneCol] || "").trim() : "";
  const emailRaw = slot.emailCol ? String(row[slot.emailCol] || "").trim() : "";
  const websiteRaw = slot.websiteCol ? String(row[slot.websiteCol] || "").trim() : "";
  const postal = parsePostalAddress(postalRaw);

  const phones = extractPhones(phoneRaw);
  const emails = extractEmailsFromText(emailRaw);
  const websites = extractWebsitesFromText(websiteRaw);

  // Build the file candidates for this slot. Source column is preserved so the
  // user can audit which Excel column a number/email came from.
  const candidatePhones = phones
    .map((p) => makePhoneCandidate({
      phone: p,
      source: "file",
      source_column: slot.phoneCol,
      phone_owner_name: name,
      relationship_to_lead_owner: "owner",
      evidence: `rôle slot ${slot.idx + 1}: ${slot.phoneCol}`,
    }))
    .filter(Boolean);
  const candidateEmails = emails
    .map((e) => makeEmailCandidate({
      email: e,
      source: "file",
      source_column: slot.emailCol,
      email_owner_name: name,
      relationship_to_lead_owner: "owner",
      evidence: `rôle slot ${slot.idx + 1}: ${slot.emailCol}`,
    }))
    .filter(Boolean);
  const candidateWebsites = websites
    .map((w) => makeWebsiteCandidate({
      website: w,
      source: "file",
      source_column: slot.websiteCol,
      website_owner_name: name,
      relationship_to_lead_owner: "owner",
      evidence: `rôle slot ${slot.idx + 1}: ${slot.websiteCol}`,
    }))
    .filter(Boolean);

  return {
    slotIdx: slot.idx,
    name,
    firstName,
    lastName,
    status,          // "Personne physique" / "Personne morale"
    postalRaw,
    postalAddress: postal,
    phones,
    emails,
    websites,
    candidatePhones,
    candidateEmails,
    candidateWebsites,
  };
}

// Extract property-level fields from a row using header maps built once
// per sheet. Numeric fields (valeurImmeuble, superficie, yearBuilt, lat,
// lon, units) are parsed through toNumber so downstream filters can
// compare them without re-parsing. String fields stay as raw strings.
function extractProperty(row, propCols) {
  const pick = (col) => (col ? String(row[col] || "").trim() : "");
  return {
    ville: pick(propCols.ville),
    adresseImmeuble: pick(propCols.adresseImmeuble),
    matricule: pick(propCols.matricule),
    utilisation: pick(propCols.utilisation),
    lot: pick(propCols.lot),
    dossier: pick(propCols.dossier),
    voisinage: pick(propCols.voisinage),
    enVigueur: pick(propCols.enVigueur),
    dateInscription: pick(propCols.dateInscription),
    dateReferenceMarche: pick(propCols.dateReferenceMarche),
    valeurImmeuble: toNumber(row[propCols.valeurImmeuble]),
    valeurTerrain: toNumber(row[propCols.valeurTerrain]),
    valeurBatiment: toNumber(row[propCols.valeurBatiment]),
    valeurImposable: toNumber(row[propCols.valeurImposable]),
    superficie: toNumber(row[propCols.superficie]),
    yearBuilt: toNumber(row[propCols.yearBuilt]),
    nbLogements: toNumber(row[propCols.nbLogements]),
    nbLocaux: toNumber(row[propCols.nbLocaux]),
    nbTotalUnites: toNumber(row[propCols.nbTotalUnites]),
    nbProprietaires: toNumber(row[propCols.nbProprietaires]),
    nbEtages: toNumber(row[propCols.nbEtages]),
    aireEtages: toNumber(row[propCols.aireEtages]),
    lat: toNumber(row[propCols.lat]),
    lon: toNumber(row[propCols.lon]),
    codePostalImmeuble: pick(propCols.codePostalImmeuble),
    telephoneImmeuble: pick(propCols.telephoneImmeuble),
    courrielImmeuble: pick(propCols.courrielImmeuble),
    siteWebImmeuble: pick(propCols.siteWebImmeuble),
    genreConstruction: pick(propCols.genreConstruction),
    lienPhysique: pick(propCols.lienPhysique),
    categorie: pick(propCols.categorie),
    sousCategorie: pick(propCols.sousCategorie),
    googleMaps: pick(propCols.googleMaps),
    // Column names retained so the candidate stamps can carry source_column
    // metadata back to the Owner/Lead records.
    _telephoneImmeubleCol: propCols.telephoneImmeuble,
    _courrielImmeubleCol: propCols.courrielImmeuble,
    _siteWebImmeubleCol: propCols.siteWebImmeuble,
  };
}

// Build a map of property-level column names → header strings found in
// the sheet. Missing columns return "" — the caller tolerates that.
function buildPropertyColumnMap(headers) {
  return {
    ville: findExactHeader(headers, "Ville"),
    adresseImmeuble: findExactHeader(headers, "Adresse Immeuble"),
    matricule: findExactHeader(headers, "Numéro de matricule"),
    utilisation: findExactHeader(headers, "Utilisation prédominante"),
    lot: findExactHeader(headers, "Numéro de lot au cadastre du Québec"),
    dossier: findExactHeader(headers, "Numéro de dossier"),
    voisinage: findExactHeader(headers, "Numéro d'unité de voisinage"),
    enVigueur: findExactHeader(headers, "En vigueur pour les exercices financiers"),
    dateInscription: findExactHeader(headers, "Date d'inscription au rôle"),
    dateReferenceMarche: findExactHeader(headers, "Date de référence au marché"),
    valeurImmeuble: findExactHeader(headers, "Valeur de l'immeuble"),
    valeurTerrain: findExactHeader(headers, "Valeur du terrain"),
    valeurBatiment: findExactHeader(headers, "Valeur du bâtiment"),
    valeurImposable: findExactHeader(headers, "Valeur imposable de l'immeuble"),
    superficie: findExactHeader(headers, "Superficie"),
    yearBuilt: findExactHeader(headers, "Année de construction"),
    nbLogements: findExactHeader(headers, "Nombre de logements"),
    nbLocaux: findExactHeader(headers, "Nombre de locaux non résidentiels"),
    nbTotalUnites: findExactHeader(headers, "Nb Total Unités"),
    nbProprietaires: findExactHeader(headers, "Nb Propriétaires"),
    nbEtages: findExactHeader(headers, "Nombre d'étages"),
    aireEtages: findExactHeader(headers, "Aire d'étages"),
    lat: findExactHeader(headers, "Lat"),
    lon: findExactHeader(headers, "Lon"),
    codePostalImmeuble: findExactHeader(headers, "Code Postal Immeuble"),
    telephoneImmeuble: findExactHeader(headers, "Téléphone Immeuble"),
    courrielImmeuble:
      findExactHeader(headers, "Courriel Immeuble") ||
      findExactHeader(headers, "Email Immeuble"),
    siteWebImmeuble:
      findExactHeader(headers, "Site web Immeuble") ||
      findExactHeader(headers, "Site Web Immeuble") ||
      findExactHeader(headers, "Website Immeuble"),
    genreConstruction: findExactHeader(headers, "Genre de construction"),
    lienPhysique: findExactHeader(headers, "Lien physique"),
    // These two have variable-length labels — use contains-matching.
    categorie: findContainsHeader(headers, "categorie", "classe", "immeuble") ||
               findExactHeader(headers, "Catégorie et classe d'immeuble à des fin"),
    sousCategorie: findExactHeader(headers, "Sous catégorie de l'immeuble"),
    googleMaps: findExactHeader(headers, "Google Maps"),
  };
}

// Core extraction: given an array of rows + header list (shape returned by
// parseSpreadsheet), produce the { properties, ownersMap, stats } triple.
// Exposed separately from parseRoleXlsx so tests can feed in synthetic
// row arrays without going through the XLSX binary path.
export function extractRoleData({ rows, headers }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const propCols = buildPropertyColumnMap(safeHeaders);
  const ownerSlots = findOwnerSlotColumns(safeHeaders);

  const properties = [];
  const ownersMap = new Map();
  let ownerEntries = 0;
  let withPhone = 0;

  safeRows.forEach((row, rowIdx) => {
    if (!row || typeof row !== "object") return;
    const prop = extractProperty(row, propCols);
    // Skip rows that don't even have a civic address — they're usually
    // trailing blank rows in the export.
    if (!prop.adresseImmeuble && !prop.matricule) return;

    const propertyId = `role_prop_${rowIdx}_${Math.random().toString(36).slice(2, 7)}`;
    const ownerKeysForProp = [];

    // Building-level (relationship = "building") candidates derived from the
    // property-level columns. Attached to the property + propagated to every
    // owner that owns it, so the lead/owner records carry building contact
    // info alongside owner contact info.
    const buildingCandidatePhones = mergePhoneLists(prop.telephoneImmeuble)
      .map((p) => makePhoneCandidate({
        phone: p,
        source: "file",
        source_column: prop._telephoneImmeubleCol || "Téléphone Immeuble",
        relationship_to_lead_owner: "building",
        evidence: `building phone column "${prop._telephoneImmeubleCol || "Téléphone Immeuble"}"`,
      }))
      .filter(Boolean);
    const buildingCandidateEmails = extractEmailsFromText(prop.courrielImmeuble || "")
      .map((e) => makeEmailCandidate({
        email: e,
        source: "file",
        source_column: prop._courrielImmeubleCol || "Courriel Immeuble",
        relationship_to_lead_owner: "building",
        evidence: `building email column "${prop._courrielImmeubleCol || "Courriel Immeuble"}"`,
      }))
      .filter(Boolean);
    const buildingCandidateWebsites = extractWebsitesFromText(prop.siteWebImmeuble || "")
      .map((w) => makeWebsiteCandidate({
        website: w,
        source: "file",
        source_column: prop._siteWebImmeubleCol || "Site web Immeuble",
        relationship_to_lead_owner: "building",
        evidence: `building website column "${prop._siteWebImmeubleCol || "Site web Immeuble"}"`,
      }))
      .filter(Boolean);

    for (const slot of ownerSlots) {
      const o = extractOwnerSlot(row, slot);
      if (!o) continue;
      ownerEntries++;
      // Build the dedup key from the owner's mailing street + postal. If
      // neither is present, fall back to the building's own address so the
      // owner still groups with siblings that share only the building.
      const street = o.postalAddress.street;
      const postalCode = o.postalAddress.postalCode;
      let key = buildOwnerKey(street, postalCode);
      if (!key || key === "|") {
        key = buildOwnerKey(prop.adresseImmeuble, prop.codePostalImmeuble);
      }
      if (!key || key === "|") continue; // nothing to group on — skip

      if (o.phones.length) withPhone++;

      const draft = {
        ownerKey: key,
        slotIdx: o.slotIdx,
        name: o.name,
        firstName: o.firstName,
        lastName: o.lastName,
        status: o.status,
        postalAddress: {
          street,
          city: o.postalAddress.city,
          province: o.postalAddress.province,
          postalCode,
        },
        phones: o.phones,
        emails: o.emails,
        websites: o.websites,
        candidatePhones: o.candidatePhones,
        candidateEmails: o.candidateEmails,
        candidateWebsites: o.candidateWebsites,
        propertyId,
      };
      if (!ownersMap.has(key)) ownersMap.set(key, []);
      ownersMap.get(key).push(draft);
      ownerKeysForProp.push(key);
    }

    properties.push({
      id: propertyId,
      rowIndex: rowIdx,
      ownerKeys: Array.from(new Set(ownerKeysForProp)),
      ...prop,
      candidatePhones: buildingCandidatePhones,
      candidateEmails: buildingCandidateEmails,
      candidateWebsites: buildingCandidateWebsites,
    });
  });

  // Owners whose phones array is empty AFTER aggregation across all their
  // slots on all their properties. Counted on the post-agg view because an
  // investor with 30 buildings might have a phone listed on only one of
  // them — they still count as "has a phone".
  let needLookup = 0;
  const uniqueKeys = [...ownersMap.keys()];
  for (const key of uniqueKeys) {
    const drafts = ownersMap.get(key);
    const allPhones = mergePhoneLists(...drafts.map(d => d.phones));
    if (!allPhones.length) needLookup++;
  }

  return {
    properties,
    ownersMap,
    stats: {
      properties: properties.length,
      ownerEntries,
      uniquePostal: uniqueKeys.length,
      withPhone: uniqueKeys.length - needLookup,
      needLookup,
    },
  };
}

// Read an XLSX File and return the extracted structure. Wraps the raw
// parseSpreadsheet call + extractRoleData; throws if the sheet is empty
// or has no recognizable owner slots.
export async function parseRoleXlsx(file) {
  const parsed = await parseSpreadsheet(file);
  if (!parsed?.rows?.length) {
    throw new Error("Le fichier XLSX ne contient aucune ligne.");
  }
  const extracted = extractRoleData(parsed);
  if (extracted.stats.ownerEntries === 0) {
    throw new Error("Aucun propriétaire détecté — vérifiez que ce fichier est bien un rôle d'évaluation.");
  }
  return {
    ...extracted,
    fileName: file?.name || "",
    sheetName: (parsed.delim || "").replace(/^XLSX · /, ""),
  };
}

// Stable-ish hash for the Owner id. Mirrors ownerGrouping.js `ownerIdFromKey`
// so the same postal address always resolves to the same Owner id across
// re-imports.
function ownerIdFromKey(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `owner_${h.toString(36)}`;
}

// Pick the most natural displayName for an owner: prefer a "Personne
// physique" (flesh-and-blood person) name if any slot had that status,
// else the most common natural-person name, else the first name seen.
function pickDisplayName(drafts) {
  const people = drafts.filter(d => /personne physique/i.test(d.status || ""));
  const pool = people.length ? people : drafts;
  // Prefer "Prénom Nom" composite when we have both pieces.
  for (const d of pool) {
    if (d.firstName && d.lastName) return `${d.firstName} ${d.lastName}`.trim();
  }
  return pool[0]?.name || drafts[0]?.name || "(Propriétaire inconnu)";
}

// Buildings from a list of properties that belong to this owner.
function buildingsForOwner(properties, ownerKey, sourceFile) {
  const seen = new Set();
  const out = [];
  for (const p of properties) {
    if (!p.ownerKeys.includes(ownerKey)) continue;
    const normAddress = normalizeStreet(p.adresseImmeuble);
    const normPostal = normalizePostal(p.codePostalImmeuble);
    const dedupKey = `${normAddress}|${normPostal}|${p.matricule || ""}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({
      id: `bld_${p.id}`,
      address: p.adresseImmeuble || "",
      buildingAddress: [p.adresseImmeuble, p.ville, "QC", p.codePostalImmeuble].filter(Boolean).join(", "),
      city: p.ville || "",
      province: "QC",
      postalCode: p.codePostalImmeuble || "",
      units: p.nbTotalUnites || p.nbLogements || 0,
      utilisation: p.utilisation || "",
      assessment: p.valeurImmeuble != null ? String(p.valeurImmeuble) : "",
      yearBuilt: p.yearBuilt != null ? String(p.yearBuilt) : "",
      lotArea: p.superficie != null ? String(p.superficie) : "",
      sourceFile: sourceFile || "",
      // rôle-specific fields preserved for downstream filters/displays
      matricule: p.matricule || "",
      lat: p.lat,
      lon: p.lon,
      valeurImmeuble: p.valeurImmeuble,
      valeurTerrain: p.valeurTerrain,
      valeurBatiment: p.valeurBatiment,
      dateInscription: p.dateInscription || "",
    });
  }
  return out;
}

// Turn the parsed structure + a CRM's existing Owner list into
// mergeable Owner records + one Lead per property. Callers then feed
// the Owner records into mergeOwners() and append Leads into App state.
//
// Options:
//   sourceFile   — string stamped on each building + lead (e.g. file name)
//   filterFn     — optional (property) => boolean; only properties passing
//                  the predicate are converted to Leads. Owners whose only
//                  properties fail the filter are STILL emitted — the owner
//                  exists in the rôle regardless of whether the user
//                  expressed interest in that specific building.
export function buildOwnersAndLeadsFromRole(parsed, existingOwners = [], options = {}) {
  const { sourceFile = "", filterFn } = options || {};
  if (!parsed?.properties || !parsed?.ownersMap) {
    return { newOwners: [], updatedOwners: [], allOwners: Array.isArray(existingOwners) ? existingOwners : [], leads: [] };
  }

  const nowIso = new Date().toISOString();
  const now = Date.now();

  // Helper: walk every property linked to an owner and collect its building-
  // level candidates (phone/email/website columns on the property row).
  function buildingCandidatesForOwner(ownerKey, field) {
    const out = [];
    for (const p of parsed.properties) {
      if (!p.ownerKeys.includes(ownerKey)) continue;
      const list = p[field];
      if (Array.isArray(list)) out.push(...list);
    }
    return out;
  }

  // Build the incoming Owner list from the ownersMap.
  const incomingOwners = [];
  for (const [ownerKey, drafts] of parsed.ownersMap) {
    const phones = mergePhoneLists(...drafts.map(d => d.phones));
    // Split names: natural persons → contactNames; companies / "personne
    // morale" → aliases.
    const contactNames = [];
    const aliases = [];
    for (const d of drafts) {
      const isPerson = /personne physique/i.test(d.status || "")
        || (d.firstName && d.lastName);
      // Fallback: numeric-looking "9338-8387 QUEBEC INC." clearly a company.
      const looksCompany = /\b(inc|ltee|ltée|ltd|sencrl|s\.?e\.?n\.?c|srl|corp|sarl|fiducie)\b/i.test(d.name)
        || /^\s*\d{3,}/.test(d.name);
      if (isPerson && !looksCompany) contactNames.push(d.name);
      else aliases.push(d.name);
    }
    const postal = drafts[0]?.postalAddress || { street: "", city: "", province: "QC", postalCode: "" };
    const phoneSources = {};
    for (const p of phones) {
      const k = normalizePhoneKey(p);
      if (!k) continue;
      phoneSources[k] = "Excel";
    }

    // Roll up the per-slot candidates (owner relationship) plus the per-
    // property building candidates (building relationship) into one list per
    // contact kind. Within each list, mergePhoneCandidates / mergeEmailCandidates /
    // mergeWebsiteCandidates dedupe by (value, source, source_column) so we
    // keep one entry per distinct provenance reference.
    const candidatePhones = mergePhoneCandidates(
      ...drafts.map(d => d.candidatePhones || []),
      buildingCandidatesForOwner(ownerKey, "candidatePhones"),
    );
    const candidateEmails = mergeEmailCandidates(
      ...drafts.map(d => d.candidateEmails || []),
      buildingCandidatesForOwner(ownerKey, "candidateEmails"),
    );
    const candidateWebsites = mergeWebsiteCandidates(
      ...drafts.map(d => d.candidateWebsites || []),
      buildingCandidatesForOwner(ownerKey, "candidateWebsites"),
    );

    incomingOwners.push({
      id: ownerIdFromKey(ownerKey),
      ownerKey,
      displayName: pickDisplayName(drafts),
      postalAddress: {
        street: postal.street || "",
        city: postal.city || "",
        province: postal.province || "QC",
        postalCode: postal.postalCode || "",
      },
      aliases: Array.from(new Set(aliases)),
      contactNames: Array.from(new Set(contactNames)),
      phones,
      phoneSources,
      matchedBusinessName: "",
      emails: flattenEmailCandidates(candidateEmails),
      websites: flattenWebsiteCandidates(candidateWebsites),
      candidatePhones,
      candidateEmails,
      candidateWebsites,
      buildings: buildingsForOwner(parsed.properties, ownerKey, sourceFile),
      stage: "new",
      callStatus: "none",
      callNotes: "",
      lastCallAt: "",
      nextCallAt: "",
      notes: "",
      createdAt: nowIso,
      updatedAt: now,
      lookupStatus: "pending",
    });
  }

  // Track which ownerKeys already existed in CRM — drives the added vs.
  // updated accounting in the return payload.
  const existingKeys = new Set(
    (Array.isArray(existingOwners) ? existingOwners : []).map(o => o?.ownerKey).filter(Boolean),
  );

  const merged = mergeOwners(existingOwners || [], incomingOwners);
  const incomingKeys = new Set(incomingOwners.map(o => o.ownerKey));

  const newOwners = merged.merged.filter(o => incomingKeys.has(o.ownerKey) && !existingKeys.has(o.ownerKey));
  const updatedOwners = merged.merged.filter(o => incomingKeys.has(o.ownerKey) && existingKeys.has(o.ownerKey));

  // Build a Lead per property; link its ownerIds by ownerKey.
  const byOwnerKey = new Map(merged.merged.map(o => [o.ownerKey, o.id]));
  const leads = [];
  const eligibleProps = typeof filterFn === "function"
    ? parsed.properties.filter(p => {
      try { return !!filterFn(p); } catch { return false; }
    })
    : parsed.properties;
  for (const p of eligibleProps) {
    const ownerIds = p.ownerKeys.map(k => byOwnerKey.get(k)).filter(Boolean);
    const phonesFromOwners = mergePhoneLists(
      ...p.ownerKeys.map(k => (parsed.ownersMap.get(k) || []).map(d => d.phones).flat()),
    );

    // Per-lead candidates: owner-relationship candidates from every owner of
    // this property + this property's own building-level candidates. The
    // dedup-by-(value, source, source_column) inside mergePhoneCandidates
    // collapses duplicates without losing per-column attribution.
    const ownerCandidatePhones = mergePhoneCandidates(
      ...p.ownerKeys.map(k => (parsed.ownersMap.get(k) || []).map(d => d.candidatePhones || []).flat()),
    );
    const ownerCandidateEmails = mergeEmailCandidates(
      ...p.ownerKeys.map(k => (parsed.ownersMap.get(k) || []).map(d => d.candidateEmails || []).flat()),
    );
    const ownerCandidateWebsites = mergeWebsiteCandidates(
      ...p.ownerKeys.map(k => (parsed.ownersMap.get(k) || []).map(d => d.candidateWebsites || []).flat()),
    );
    const candidatePhones = mergePhoneCandidates(ownerCandidatePhones, p.candidatePhones || []);
    const candidateEmails = mergeEmailCandidates(ownerCandidateEmails, p.candidateEmails || []);
    const candidateWebsites = mergeWebsiteCandidates(ownerCandidateWebsites, p.candidateWebsites || []);

    const allPhones = flattenPhoneCandidates(candidatePhones);
    const allEmails = flattenEmailCandidates(candidateEmails);
    const allWebsites = flattenWebsiteCandidates(candidateWebsites);

    leads.push({
      id: `lead_role_${p.id}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowIso,
      updatedAt: now,
      stage: phonesFromOwners.length ? "to_call" : "new",
      companyName: "",
      contactName: "",
      buildingAddress: [p.adresseImmeuble, p.ville, "QC", p.codePostalImmeuble].filter(Boolean).join(", "),
      address: p.adresseImmeuble || "",
      city: p.ville || "",
      province: "QC",
      postalCode: p.codePostalImmeuble || "",
      country: "Canada",
      email: pickBestEmail(candidateEmails),
      phone: pickBestPhone(candidatePhones) || phonesFromOwners[0] || "",
      website: pickBestWebsite(candidateWebsites),
      phones: allPhones.length ? allPhones : phonesFromOwners,
      emails: allEmails,
      websites: allWebsites,
      candidatePhones,
      candidateEmails,
      candidateWebsites,
      originalPhone: "",
      units: p.nbTotalUnites || p.nbLogements || 0,
      utilisation: p.utilisation || "",
      assessment: p.valeurImmeuble != null ? String(p.valeurImmeuble) : "",
      yearBuilt: p.yearBuilt != null ? String(p.yearBuilt) : "",
      lotArea: p.superficie != null ? String(p.superficie) : "",
      sourceFile: sourceFile || "Rôle d'évaluation",
      notes: `Importé du rôle — matricule ${p.matricule || "n/a"}`,
      matricule: p.matricule || "",
      ownerIds,
      lat: p.lat,
      lon: p.lon,
      linkedDealId: "",
      lookupStatus: phonesFromOwners.length ? "found" : "pending",
    });
  }

  return {
    newOwners,
    updatedOwners,
    allOwners: merged.merged,
    leads,
  };
}
