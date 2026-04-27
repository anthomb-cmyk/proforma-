// proforma-web/src/lib/searchPackage.js
//
// Build canonical owner/entity search packages from already-imported lead/
// owner data. The package is a structured "what should we search, why, and
// how" record consumed downstream by enrichment workflows (Phone Finder,
// related-company discovery, etc.).
//
// Pure utility — zero network, zero I/O. Safe to import from anywhere.
//
// Public API (used by tests + future Phone Finder integration):
//   buildSearchPackages(inputRows, options?)
//   classifyLegalEntity(name, statusRaw?)
//   assessSearchPriority(pkg)
//   chooseSearchStrategy(pkg)
//   buildDirectEntityQueries(pkg)
//   buildMailingAddressDiscoveryQueries(pkg)
//   summarizeSearchPackage(pkg)
//   previewSearchPackages(inputRows, options?)
//
// Input shapes accepted by buildSearchPackages:
//   • Owner[] — already-grouped Owner records (with `ownerKey`, `displayName`,
//     `aliases`, `contactNames`, `buildings`, `phones`, `emails`, `websites`,
//     `candidatePhones`, `candidateEmails`, `candidateWebsites`,
//     `postalAddress: { street, city, province, postalCode }`).
//   • Lead-like[] — plain rows that look like Lead records (`companyName`,
//     `contactName`, `phone`, `phones`, `email`, `website`, `candidatePhones`,
//     ..., plus `address` / `city` / `province` / `postalCode` for the
//     mailing/building address). These are grouped by normalized name +
//     mailing postal.
// The two shapes can be mixed in one input array — each item is detected by
// whether it carries an `ownerKey` + `buildings` array.

import {
  mergePhoneLists,
  normalizePhoneKey,
  normalizeTextKey,
} from "./phoneUtils.js";
import {
  mergeEmailLists,
  mergeWebsiteLists,
  mergePhoneCandidates,
  mergeEmailCandidates,
  mergeWebsiteCandidates,
  flattenPhoneCandidates,
  flattenEmailCandidates,
  flattenWebsiteCandidates,
} from "./contactCandidates.js";

// ─── Legal-entity classification ───────────────────────────────────────────

// Numbered company forms commonly seen in Québec rôles:
//   "9338-8387 QUEBEC INC."  /  "1234567 Inc."  /  "9876-5432 CANADA INC."
//   "12345 Canada Limitée"   /  "9111-1111 Qc Inc"
const NUMBERED_RE =
  /^\s*\d{2,7}[-\s]?\d{0,7}\s*(?:qu[ée]bec|quebec|canada|qc|on|bc|ab)?\s*(?:inc|inc\.|ltée|ltee|ltd|ltée\.|limit[eé]e)\.?\s*$/i;

// Domain-marker patterns. Listed in priority order — the FIRST one that hits
// wins. We intentionally rank "trust" + "society" + "immobilier" /
// "investments" / "holdings" / "gestion" above the generic "inc_ltee" so a
// "Gestion Immobilière X Inc" is classified as `immobilier` not `inc_ltee`.
const TRUST_RE = /\b(fiducie|trust|trustee|succession|estate of)\b/i;
const SOCIETY_RE = /\b(soci[eé]t[eé]|society|coop(?:[ée]rative)?|cooperative|association|asso\.?|club)\b/i;
const IMMOBILIER_RE = /\b(immobili[eè]re?|immobilier|realty|properties|property|real ?estate)\b/i;
const INVESTMENTS_RE = /\b(investments?|investissements?|invest|capital|equity|equit[eé])\b/i;
const HOLDINGS_RE = /\b(holdings?|holding|portfolio)\b/i;
const GESTION_RE = /\b(gestion|management|gestionnaire)\b/i;
const INC_LTEE_RE = /\b(inc|ltée|ltee|ltd|llc|corp|corporation|s\.?a\.?r\.?l\.?|sencrl|s\.?e\.?n\.?c)\.?\b/i;

// Heuristic for "looks like an individual" — borrowed from
// services/phoneEnrichment.js looksLikePersonalName but kept pure-string.
function looksLikeIndividual(name) {
  const t = String(name || "").trim();
  if (!t) return false;
  if (/\d/.test(t)) return false;
  // Company hints override
  if (INC_LTEE_RE.test(t) || TRUST_RE.test(t) || SOCIETY_RE.test(t)
      || IMMOBILIER_RE.test(t) || INVESTMENTS_RE.test(t)
      || HOLDINGS_RE.test(t) || GESTION_RE.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => w.length >= 2 && w.length <= 24);
}

export function classifyLegalEntity(name, statusRaw) {
  const t = String(name || "").trim();
  if (!t) return "unknown";
  // Status flag is the strongest individual signal — taxes mark it explicitly.
  if (/personne\s+physique|individual|natural\s+person/i.test(String(statusRaw || ""))) {
    return "individual";
  }
  // Numbered companies — purely structural; trumps every other marker.
  if (NUMBERED_RE.test(t)) return "numbered_company";
  if (TRUST_RE.test(t)) return "trust";
  if (SOCIETY_RE.test(t)) return "society";
  if (IMMOBILIER_RE.test(t)) return "immobilier";
  if (INVESTMENTS_RE.test(t)) return "investments";
  if (HOLDINGS_RE.test(t)) return "holdings";
  if (GESTION_RE.test(t)) return "gestion";
  if (INC_LTEE_RE.test(t)) return "inc_ltee";
  if (looksLikeIndividual(t)) return "individual";
  return "unknown";
}

// Categories the search pipeline should attempt to enrich. Individual people
// and pure unknowns are still tracked, but are deprioritized below.
const SEARCHABLE_CATEGORIES = new Set([
  "numbered_company",
  "inc_ltee",
  "gestion",
  "immobilier",
  "investments",
  "holdings",
  "trust",
  "society",
]);

// ─── Mailing-address quality ───────────────────────────────────────────────

// Returns "good" (street + city + postal), "partial" (some pieces), "missing".
function mailingAddressQuality(pkg) {
  const street = String(pkg.mailing_address || "").trim();
  const city = String(pkg.mailing_city || "").trim();
  const postal = String(pkg.mailing_postal_code || "").trim();
  if (street && city && postal) return "good";
  if (street || (city && postal)) return "partial";
  return "missing";
}

// Returns true when the package carries at least one NANP-valid phone.
function hasValidPhone(pkg) {
  for (const p of pkg.existing_phones || []) {
    if (normalizePhoneKey(p)) return true;
  }
  for (const c of pkg.candidatePhones || []) {
    if (normalizePhoneKey(c?.phone)) return true;
  }
  return false;
}

// Identity markers that mean the "name" cell is junk and shouldn't be used
// as a search query. Mirrors services/phoneEnrichment.js isJunkBusinessName.
const JUNK_RE = /^(?:\d{6,8}|[\d\-]{10,30}|[a-z]{0,3}\d+[a-z]{0,3})$/i;
const EMAIL_AS_NAME_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_AS_NAME_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const MUNICIPAL_RE =
  /^(ville|municipalit[eé]|mrc|r[eé]gie|agglom[eé]ration|h[oô]tel\s+de\s+ville|gouvernement)\b/i;

function looksLikeJunkName(name) {
  const t = String(name || "").trim();
  if (!t) return true;
  if (JUNK_RE.test(t)) return true;
  if (EMAIL_AS_NAME_RE.test(t)) return true;
  if (URL_AS_NAME_RE.test(t)) return true;
  if (MUNICIPAL_RE.test(t)) return true;
  if (!/[a-zÀ-ſ]/i.test(t)) return true;
  return false;
}

// ─── Priority + strategy ───────────────────────────────────────────────────

// ─── Lead value vs. search need ────────────────────────────────────────────
//
// These two axes are deliberately separate:
//
//   • lead_value_priority — how valuable is this lead independent of how
//     complete its contact info is. A company with a 12-property portfolio
//     stays high-value even after we already have its phone number; an
//     individual with one duplex stays low-value even with no phone.
//
//   • search_need_priority — how much enrichment work this package still
//     needs. A package with a known file phone has LOW search need, even
//     though the lead itself may be HIGH value. "skip" means "don't search
//     at all" — typically used for junk or empty records.
//
// Code that ranks leads for a sales queue should sort by lead_value_priority.
// Code that ranks the enrichment queue should sort by search_need_priority.
// `search_priority` is kept on the package as a backwards-compatible alias
// for search_need_priority — same value, same semantics, older callers can
// keep using it.

// Lead value: portfolio + entity strength, ignoring contact-completeness.
// Returns "high" | "medium" | "low". Never "skip" — even an empty record is
// still a lead, just a low-value one.
export function assessLeadValue(pkg) {
  if (!pkg) return "low";
  const cat = pkg.legal_entity_category;
  const isSearchable = !!pkg.is_searchable_entity;
  const isIndividual = cat === "individual";
  const propertyCount = Array.isArray(pkg.associated_properties)
    ? pkg.associated_properties.length
    : 0;
  const totalUnits = (pkg.associated_properties || [])
    .reduce((s, p) => s + (Number(p?.units) || 0), 0);
  const quality = mailingAddressQuality(pkg);
  const isJunk = looksLikeJunkName(pkg.lead_owner_name);

  // Searchable entities (companies / trusts / etc.) are high-value when they
  // hold a portfolio. Mailing-address quality is a tie-breaker; the portfolio
  // alone is enough to clear the "high" bar.
  if (isSearchable && (propertyCount >= 2 || totalUnits >= 10)) return "high";
  // Searchable entity with at least one property OR usable mailing → medium.
  if (isSearchable && (propertyCount >= 1 || quality !== "missing")) return "medium";
  // Bare searchable entity with literally nothing else → low.
  if (isSearchable) return "low";

  // Individuals with sizeable portfolios are still worth pursuing.
  if (isIndividual && (propertyCount >= 3 || totalUnits >= 12)) return "high";
  if (isIndividual && (propertyCount >= 2 || totalUnits >= 6)) return "medium";

  // Junk / unknown / single-property individual → low.
  if (isJunk) return "low";
  return "low";
}

export function assessSearchPriority(pkg) {
  if (!pkg) return "skip";
  const quality0 = mailingAddressQuality(pkg);
  if (looksLikeJunkName(pkg.lead_owner_name)) {
    // No usable name AND no mailing → literally nothing to search.
    if (quality0 === "missing") return "skip";
    return "low";
  }

  const hasPhone = hasValidPhone(pkg);
  const isSearchable = !!pkg.is_searchable_entity;
  const cat = pkg.legal_entity_category;
  const isIndividual = cat === "individual";
  const quality = mailingAddressQuality(pkg);
  const propertyCount = Array.isArray(pkg.associated_properties)
    ? pkg.associated_properties.length
    : 0;
  const totalUnits = (pkg.associated_properties || [])
    .reduce((sum, p) => sum + (Number(p?.units) || 0), 0);

  // If the entity already has a phone we don't need to search — keep the
  // package but mark it low so it falls to the bottom of the queue.
  if (hasPhone) return "low";

  // Individuals: usually low value to enrich at scale unless they own a
  // sizeable portfolio.
  if (isIndividual) {
    if (quality === "missing" && propertyCount === 0) return "skip";
    if (propertyCount >= 3 || totalUnits >= 12) return "medium";
    return "low";
  }

  if (!isSearchable && cat === "unknown") {
    if (quality === "missing") return "skip";
    return "low";
  }

  // Companies / entities below: priority scales with portfolio size + address.
  if (quality === "good" && (propertyCount >= 2 || totalUnits >= 10)) return "high";
  if (quality === "good" || propertyCount >= 2 || totalUnits >= 10) return "medium";
  if (quality === "partial") return "medium";
  return "low";
}

export function chooseSearchStrategy(pkg) {
  if (!pkg) return "skip_low_value";
  // Empty / missing name + missing mailing → nothing to review or search.
  // Distinguish from a non-empty-but-unparseable name (e.g. "12345678"),
  // which gets needs_manual_review so the operator can fix it by hand.
  const nameTrim = String(pkg.lead_owner_name || "").trim();
  if (looksLikeJunkName(pkg.lead_owner_name)) {
    if (!nameTrim && mailingAddressQuality(pkg) === "missing") return "skip_low_value";
    return "needs_manual_review";
  }

  // File-phone shortcut wins ahead of every other strategy. Carries through
  // the existing PR #1 contract: "we already have it; don't pay to look it up
  // again."
  if (hasValidPhone(pkg)) return "use_file_phone";

  if (pkg.search_priority === "skip") return "skip_low_value";

  const quality = mailingAddressQuality(pkg);
  const cat = pkg.legal_entity_category;
  const hasUsefulName = !!pkg.lead_owner_name
    && cat !== "unknown"
    && cat !== "individual"
    && !looksLikeJunkName(pkg.lead_owner_name);

  // Numbered companies have no useful name to search by — fall back to
  // mailing-address discovery (find the human owners by who else mails to
  // the same address).
  if (cat === "numbered_company") {
    if (quality !== "missing") return "mailing_address_only";
    return "skip_low_value";
  }

  if (hasUsefulName && quality !== "missing") {
    return "direct_entity_then_mailing_address_related_companies";
  }
  if (hasUsefulName) return "direct_entity";
  if (quality !== "missing") return "mailing_address_only";

  // Individual with no mailing or anything else useful.
  return "skip_low_value";
}

// ─── Query builders ────────────────────────────────────────────────────────

function joinNonEmpty(parts, sep = ", ") {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join(sep);
}

export function buildDirectEntityQueries(pkg) {
  if (!pkg) return [];
  const name = String(pkg.lead_owner_name || "").trim();
  if (!name) return [];
  if (pkg.legal_entity_category === "numbered_company") return [];
  if (pkg.legal_entity_category === "individual") return [];
  if (looksLikeJunkName(name)) return [];

  const city = String(pkg.mailing_city || "").trim();
  const prov = String(pkg.mailing_province || "").trim();
  const street = String(pkg.mailing_address || "").trim();

  const seen = new Set();
  const out = [];
  const push = (q) => {
    const trimmed = String(q || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  // Most specific first: name + city + province.
  if (city) push(joinNonEmpty([name, city, prov]));
  // Name anchored at mailing street (catches owner-occupied storefronts).
  if (street) push(joinNonEmpty([name, street, city, prov]));
  // Name + province only (when city missing).
  if (!city && prov) push(joinNonEmpty([name, prov]));
  // Bare name as last fallback.
  push(name);
  return out;
}

export function buildMailingAddressDiscoveryQueries(pkg) {
  if (!pkg) return [];
  const street = String(pkg.mailing_address || "").trim();
  const city = String(pkg.mailing_city || "").trim();
  const prov = String(pkg.mailing_province || "").trim();
  const postal = String(pkg.mailing_postal_code || "").trim();
  if (!street && !(city && postal)) return [];

  const seen = new Set();
  const out = [];
  const push = (q) => {
    const trimmed = String(q || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  if (street) push(joinNonEmpty([street, city, prov, postal]));
  if (street && city) push(`companies ${joinNonEmpty([street, city, prov])}`);
  if (street && city) push(`businesses ${joinNonEmpty([street, city, prov])}`);
  if (street && postal) push(joinNonEmpty([street, postal]));
  return out;
}

// ─── Input normalization + grouping ────────────────────────────────────────

// Owner-shaped input has these tells.
function isOwnerShaped(item) {
  if (!item || typeof item !== "object") return false;
  return Array.isArray(item.buildings)
    || (item.postalAddress && typeof item.postalAddress === "object" && "street" in item.postalAddress);
}

// Pull the owner identity from whichever shape the row carries.
function extractIdentity(item) {
  if (isOwnerShaped(item)) {
    const postal = item.postalAddress || {};
    const name = String(item.displayName || (item.contactNames || [])[0] || (item.aliases || [])[0] || "").trim();
    return {
      name,
      status: item.status || "",
      mailing_address: String(postal.street || "").trim(),
      mailing_city: String(postal.city || "").trim(),
      mailing_province: String(postal.province || "").trim(),
      mailing_postal_code: String(postal.postalCode || "").trim(),
      contactNames: Array.isArray(item.contactNames) ? item.contactNames.slice() : [],
      aliases: Array.isArray(item.aliases) ? item.aliases.slice() : [],
    };
  }
  // Lead-like fallback. We treat companyName / contactName as the owner name
  // and use lead address fields as the mailing address — caller can layer in
  // more sophisticated mapping when available.
  const name = String(
    item.companyName || item.contactName || item.lead_owner_name || item.matchedName || "",
  ).trim();
  return {
    name,
    status: item.status || item.legal_entity_category_hint || "",
    mailing_address: String(item.mailing_address || item.address || "").trim(),
    mailing_city: String(item.mailing_city || item.city || "").trim(),
    mailing_province: String(item.mailing_province || item.province || "").trim(),
    mailing_postal_code: String(item.mailing_postal_code || item.postalCode || "").trim(),
    contactNames: Array.isArray(item.contactNames) ? item.contactNames.slice() : [],
    aliases: Array.isArray(item.aliases) ? item.aliases.slice() : [],
  };
}

// Build a stable grouping key for a row. We collapse on normalized name +
// normalized postal so two rows for the same owner from different files /
// re-imports merge into one package.
function groupKeyFor(identity) {
  const namePart = normalizeTextKey(identity.name) || "_";
  const street = normalizeTextKey(identity.mailing_address) || "";
  const postal = normalizeTextKey(identity.mailing_postal_code) || "";
  // Postal is the strongest mailing-address fingerprint; use it whenever
  // present. Otherwise fall back to street so we still group by physical
  // location even if the postal code is missing.
  const mailingPart = postal || street || "_nomail";
  return `${namePart}|${mailingPart}`;
}

// Pull every property attached to an owner-shaped row. Returns simple plain
// objects so test assertions stay shallow.
function buildingsToProperties(item) {
  if (!isOwnerShaped(item)) return [];
  return (item.buildings || []).map((b, idx) => ({
    address: String(b?.address || "").trim(),
    city: String(b?.city || "").trim(),
    province: String(b?.province || "").trim(),
    postalCode: String(b?.postalCode || "").trim(),
    units: Number(b?.units) || 0,
    utilisation: String(b?.utilisation || "").trim(),
    matricule: String(b?.matricule || "").trim(),
    sourceFile: String(b?.sourceFile || "").trim(),
    _idx: idx,
  })).filter((p) => p.address || p.matricule);
}

// Lead-like rows describe one property each — wrap into a single-element list.
function leadLikeToProperties(item) {
  if (isOwnerShaped(item)) return [];
  const address = String(item.address || item.buildingAddress || "").trim();
  const city = String(item.city || "").trim();
  if (!address && !city) return [];
  return [{
    address,
    city,
    province: String(item.province || "").trim(),
    postalCode: String(item.postalCode || "").trim(),
    units: Number(item.units) || 0,
    utilisation: String(item.utilisation || "").trim(),
    matricule: String(item.matricule || "").trim(),
    sourceFile: String(item.sourceFile || "").trim(),
  }];
}

// Property dedup key — same address + same postal => same property.
function propertyKey(p) {
  return `${normalizeTextKey(p.address)}|${normalizeTextKey(p.postalCode)}|${normalizeTextKey(p.matricule)}`;
}

// ─── Core builder ──────────────────────────────────────────────────────────

export function buildSearchPackages(inputRows, options = {}) {
  if (!Array.isArray(inputRows) || !inputRows.length) return [];

  const groups = new Map();

  inputRows.forEach((row, rowIdx) => {
    if (!row || typeof row !== "object") return;
    const id = extractIdentity(row);
    const key = groupKeyFor(id);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        identity: id,
        names: new Set(id.name ? [id.name] : []),
        contactNames: new Set(id.contactNames),
        aliases: new Set(id.aliases),
        existingPhones: [],
        existingEmails: [],
        existingWebsites: [],
        candidatePhones: [],
        candidateEmails: [],
        candidateWebsites: [],
        propertiesByKey: new Map(),
        sourceRowIndices: [],
        warnings: new Set(),
      };
      groups.set(key, g);
    } else {
      // Keep the first-seen mailing identity but absorb extra names from
      // sibling rows so multi-slot owner sheets don't lose information.
      if (id.name) g.names.add(id.name);
      for (const n of id.contactNames) g.contactNames.add(n);
      for (const a of id.aliases) g.aliases.add(a);
      // Backfill mailing pieces if the original was missing them.
      if (!g.identity.mailing_address && id.mailing_address) g.identity.mailing_address = id.mailing_address;
      if (!g.identity.mailing_city && id.mailing_city) g.identity.mailing_city = id.mailing_city;
      if (!g.identity.mailing_province && id.mailing_province) g.identity.mailing_province = id.mailing_province;
      if (!g.identity.mailing_postal_code && id.mailing_postal_code) g.identity.mailing_postal_code = id.mailing_postal_code;
    }

    g.sourceRowIndices.push(rowIdx);

    // Phones / emails / websites — both flat (legacy) and candidate arrays.
    g.existingPhones.push(...mergePhoneLists(
      Array.isArray(row.phones) ? row.phones : [],
      row.phone,
      row.originalPhone,
    ));
    g.existingEmails.push(...mergeEmailLists(
      Array.isArray(row.emails) ? row.emails : [],
      row.email,
    ));
    g.existingWebsites.push(...mergeWebsiteLists(
      Array.isArray(row.websites) ? row.websites : [],
      row.website,
    ));

    if (Array.isArray(row.candidatePhones)) g.candidatePhones.push(...row.candidatePhones);
    if (Array.isArray(row.candidateEmails)) g.candidateEmails.push(...row.candidateEmails);
    if (Array.isArray(row.candidateWebsites)) g.candidateWebsites.push(...row.candidateWebsites);

    // Properties: from buildings (owner shape) or the single building this
    // row represents (lead-like shape).
    const props = isOwnerShaped(row) ? buildingsToProperties(row) : leadLikeToProperties(row);
    for (const p of props) {
      const pk = propertyKey(p);
      if (!g.propertiesByKey.has(pk)) g.propertiesByKey.set(pk, p);
    }
  });

  const packages = [];
  for (const g of groups.values()) {
    const id = g.identity;
    const leadOwnerName = id.name
      || [...g.names][0]
      || [...g.aliases][0]
      || [...g.contactNames][0]
      || "";
    const normalized = normalizeTextKey(leadOwnerName);
    const category = classifyLegalEntity(leadOwnerName, id.status);
    const isSearchable = SEARCHABLE_CATEGORIES.has(category);

    // Co-owners = every distinct contact/alias name on the same mailing
    // address EXCEPT the chosen lead_owner_name.
    const coOwners = [];
    const coSeen = new Set();
    for (const n of [...g.contactNames, ...g.aliases]) {
      const t = String(n || "").trim();
      if (!t || t === leadOwnerName) continue;
      const k = normalizeTextKey(t);
      if (coSeen.has(k)) continue;
      coSeen.add(k);
      coOwners.push(t);
    }

    // Dedupe the flat phones/emails/websites lists.
    const existing_phones = mergePhoneLists(g.existingPhones);
    const existing_emails = mergeEmailLists(g.existingEmails);
    const existing_websites = mergeWebsiteLists(g.existingWebsites);

    // Dedupe candidate arrays — preserve every distinct (value, source,
    // source_column) tuple per PR #1's contract.
    const candidatePhones = mergePhoneCandidates(g.candidatePhones);
    const candidateEmails = mergeEmailCandidates(g.candidateEmails);
    const candidateWebsites = mergeWebsiteCandidates(g.candidateWebsites);

    // Backfill the flat arrays from candidates so callers reading
    // existing_* always see every value the package knows about.
    const allPhones = mergePhoneLists(existing_phones, flattenPhoneCandidates(candidatePhones));
    const allEmails = mergeEmailLists(existing_emails, flattenEmailCandidates(candidateEmails));
    const allWebsites = mergeWebsiteLists(existing_websites, flattenWebsiteCandidates(candidateWebsites));

    const associatedProperties = [...g.propertiesByKey.values()]
      .map((p) => {
        // Strip the internal _idx ordering helper.
        const { _idx, ...rest } = p;
        return rest;
      });

    const warnings = [...g.warnings];
    if (!leadOwnerName) warnings.push("missing_owner_name");
    if (!id.mailing_address && !id.mailing_postal_code) warnings.push("missing_mailing_address");
    if (looksLikeJunkName(leadOwnerName)) warnings.push("owner_name_looks_junk");

    const pkg = {
      lead_owner_name: leadOwnerName,
      normalized_owner_name: normalized,
      legal_entity_category: category,
      is_searchable_entity: isSearchable,
      mailing_address: id.mailing_address || "",
      mailing_city: id.mailing_city || "",
      mailing_province: id.mailing_province || "",
      mailing_postal_code: id.mailing_postal_code || "",
      existing_phones: allPhones,
      existing_emails: allEmails,
      existing_websites: allWebsites,
      candidatePhones,
      candidateEmails,
      candidateWebsites,
      associated_properties: associatedProperties,
      co_owners: coOwners,
      primary_target: "phone",
      secondary_targets: ["email", "website"],
      warnings,
      source_row_indices: g.sourceRowIndices.slice(),
    };

    // Lead value + search need are independent axes — both depend on the rest
    // of the package, so assess last. `search_priority` is retained as an
    // alias for `search_need_priority` so existing callers keep working.
    pkg.lead_value_priority = assessLeadValue(pkg);
    const searchNeed = assessSearchPriority(pkg);
    pkg.search_need_priority = searchNeed;
    pkg.search_priority = searchNeed;
    pkg.search_strategy = chooseSearchStrategy(pkg);
    pkg.direct_entity_queries = buildDirectEntityQueries(pkg);
    pkg.mailing_address_discovery_queries = buildMailingAddressDiscoveryQueries(pkg);
    pkg.reason = buildReason(pkg);

    // Enrichment scoring — must run after all other fields are set.
    const searchabilityScore = computeSearchabilityScore(pkg);
    const leadValueScore = computeLeadValueScore(pkg);
    const dataQualityScore = computeDataQualityScore(pkg);
    const enrichmentScore = computeEnrichmentScore(searchabilityScore, leadValueScore, dataQualityScore);
    const searchEligible = computeSearchEligible(pkg);
    pkg.search_eligible = searchEligible;
    pkg.searchability_score = searchabilityScore;
    pkg.searchability_priority = searchabilityPriorityFromScore(searchabilityScore);
    pkg.lead_value_score = leadValueScore;
    pkg.data_quality_score = dataQualityScore;
    pkg.enrichment_score = enrichmentScore;
    pkg.enrichment_search_priority = enrichmentPriorityFromScore(enrichmentScore, searchEligible);
    pkg.enrichment_reason = buildEnrichmentReason(pkg);

    packages.push(pkg);
  }

  // Second pass: address-aware duplicate detection. Same-address duplicates
  // are already collapsed by the grouping above (they share groupKey), so a
  // package's ownerKey is unique-by-mailing. Two packages can still share the
  // same `normalized_owner_name` only when their MAILING ADDRESSES differ —
  // that's the legitimate "same name, different address" case (e.g. an
  // investor with two operating companies under the same person's name, OR
  // two unrelated people with the same name living in different cities).
  //
  // We expose this as `duplicate_different_address: true` + a list of
  // sibling packages' mailing descriptors. This is INFORMATIONAL — it's not
  // a "suspicious split". Same-address duplicates never reach this branch.
  const byNormName = new Map();
  for (const p of packages) {
    const key = p.normalized_owner_name;
    if (!key) continue;
    if (!byNormName.has(key)) byNormName.set(key, []);
    byNormName.get(key).push(p);
  }
  for (const p of packages) {
    p.duplicate_different_address = false;
    p.address_variant_packages = [];
  }
  for (const [, group] of byNormName) {
    if (group.length < 2) continue;
    for (const p of group) {
      p.duplicate_different_address = true;
      p.address_variant_packages = group
        .filter((q) => q !== p)
        .map((q) => ({
          mailing_address: q.mailing_address || "",
          mailing_city: q.mailing_city || "",
          mailing_province: q.mailing_province || "",
          mailing_postal_code: q.mailing_postal_code || "",
          source_row_indices: (q.source_row_indices || []).slice(),
        }));
      // Refresh the reason so it carries the new flag.
      p.reason = buildReason(p);
    }
  }

  // Stable ordering: by source_row_indices[0] so callers can map packages
  // back to input order. Empty-index groups sink to the bottom.
  packages.sort((a, b) => {
    const ai = a.source_row_indices[0] ?? Number.MAX_SAFE_INTEGER;
    const bi = b.source_row_indices[0] ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });

  if (options.minPriority) {
    const order = { skip: 0, low: 1, medium: 2, high: 3 };
    const cutoff = order[options.minPriority] ?? 0;
    return packages.filter((p) => (order[p.search_priority] ?? 0) >= cutoff);
  }
  return packages;
}

// Construct a short diagnostic reason describing why this package landed in
// its priority/strategy. Useful for the previewSearchPackages output and any
// future audit log.
function buildReason(pkg) {
  const parts = [];
  parts.push(`category=${pkg.legal_entity_category}`);
  parts.push(`lead_value=${pkg.lead_value_priority}`);
  parts.push(`search_need=${pkg.search_need_priority || pkg.search_priority}`);
  parts.push(`strategy=${pkg.search_strategy}`);
  if (hasValidPhone(pkg)) parts.push("has_existing_phone");
  if (Array.isArray(pkg.associated_properties) && pkg.associated_properties.length) {
    parts.push(`properties=${pkg.associated_properties.length}`);
  }
  const totalUnits = (pkg.associated_properties || [])
    .reduce((s, p) => s + (Number(p?.units) || 0), 0);
  if (totalUnits) parts.push(`units=${totalUnits}`);
  parts.push(`mailing=${mailingAddressQuality(pkg)}`);
  if (pkg.duplicate_different_address) {
    const n = (pkg.address_variant_packages || []).length;
    parts.push(`dup_diff_addr=${n + 1}`);
  }
  if ((pkg.warnings || []).length) parts.push(`warn=${pkg.warnings.join("|")}`);
  return parts.join(" · ");
}

// ─── Enrichment scoring model ─────────────────────────────────────────────────
//
// Three orthogonal inputs → one composite enrichment_score (0-100):
//
//   searchability_score  (60% weight) — how findable the entity is online.
//   lead_value_score     (25% weight) — how valuable the lead is if contacted.
//   data_quality_score   (15% weight) — how complete the name+address data is.
//
// Tier mapping:
//   enrichment_score ≥ 75 → "high"
//   enrichment_score 45-74 → "medium"
//   enrichment_score 1-44  → "low"
//   score = 0 or ineligible → "skipped"

const LEAD_VALUE_SCORES = { high: 100, medium: 60, low: 25 };

function computeLeadValueScore(pkg) {
  return LEAD_VALUE_SCORES[pkg.lead_value_priority] ?? 25;
}

function computeSearchabilityScore(pkg) {
  const name = String(pkg.lead_owner_name || "").trim();
  if (!name || looksLikeJunkName(name)) return 0;
  const cat = pkg.legal_entity_category;
  const quality = mailingAddressQuality(pkg);
  const propertyCount = (pkg.associated_properties || []).length;
  const totalUnits = (pkg.associated_properties || [])
    .reduce((s, p) => s + (Number(p?.units) || 0), 0);

  if (cat === "individual") {
    if (quality === "missing" && propertyCount === 0) return 0;
    if (propertyCount >= 2 || totalUnits >= 6) return 45;
    return 25;
  }
  if (cat === "numbered_company") return quality !== "missing" ? 60 : 40;
  if (cat === "trust") return quality !== "missing" ? 75 : 55;
  // All other entity categories (immobilier, gestion, investments, holdings,
  // inc_ltee, society, unknown): searchable via name; mailing improves score.
  return quality !== "missing" ? 100 : 80;
}

function computeDataQualityScore(pkg) {
  const name = String(pkg.lead_owner_name || "").trim();
  const street = String(pkg.mailing_address || "").trim();
  const city = String(pkg.mailing_city || "").trim();
  const postal = String(pkg.mailing_postal_code || "").trim();
  const hasName = !!name && !looksLikeJunkName(name);
  const hasStreet = !!street;
  const hasCityPostal = !!(city && postal);
  if (hasName && hasStreet && hasCityPostal) return 100;
  if (hasName && hasStreet) return 80;
  if (hasName) return 40;
  if (hasStreet) return 20;
  return 0;
}

function computeEnrichmentScore(searchability, leadValue, dataQuality) {
  return Math.round(searchability * 0.60 + leadValue * 0.25 + dataQuality * 0.15);
}

function enrichmentPriorityFromScore(score, eligible) {
  if (!eligible || score === 0) return "skipped";
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function searchabilityPriorityFromScore(score) {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  if (score > 0) return "low";
  return "skip";
}

function computeSearchEligible(pkg) {
  if (pkgHasOwnerFilePhone(pkg)) return false;
  const name = String(pkg.lead_owner_name || "").trim();
  if (!name || looksLikeJunkName(name)) return false;
  return true;
}

function buildEnrichmentReason(pkg) {
  const parts = [];
  if (!pkg.search_eligible) parts.push("not_eligible");
  parts.push(`category=${pkg.legal_entity_category}`);
  parts.push(`searchability=${pkg.searchability_score}`);
  parts.push(`lead_value_score=${pkg.lead_value_score}`);
  parts.push(`data_quality=${pkg.data_quality_score}`);
  parts.push(`enrichment_score=${pkg.enrichment_score}`);
  parts.push(`priority=${pkg.enrichment_search_priority}`);
  return parts;
}

// Sort comparator for enrichment target buckets.
function enrichmentSortComparator(a, b) {
  if (b.enrichment_score !== a.enrichment_score) return (b.enrichment_score || 0) - (a.enrichment_score || 0);
  if (b.lead_value_score !== a.lead_value_score) return (b.lead_value_score || 0) - (a.lead_value_score || 0);
  const ap = (a.associated_properties || []).length;
  const bp = (b.associated_properties || []).length;
  if (bp !== ap) return bp - ap;
  const au = (a.associated_properties || []).reduce((s, x) => s + (Number(x?.units) || 0), 0);
  const bu = (b.associated_properties || []).reduce((s, x) => s + (Number(x?.units) || 0), 0);
  if (bu !== au) return bu - au;
  const am = (a.mailing_address || a.mailing_postal_code) ? 1 : 0;
  const bm = (b.mailing_address || b.mailing_postal_code) ? 1 : 0;
  if (bm !== am) return bm - am;
  // Entity before individual.
  return (b.legal_entity_category === "individual" ? 0 : 1) - (a.legal_entity_category === "individual" ? 0 : 1);
}

// ─── Preview helpers ───────────────────────────────────────────────────────

export function summarizeSearchPackage(pkg) {
  if (!pkg) return "";
  const phones = (pkg.existing_phones || []).length;
  const emails = (pkg.existing_emails || []).length;
  const sites = (pkg.existing_websites || []).length;
  const candP = (pkg.candidatePhones || []).length;
  const candE = (pkg.candidateEmails || []).length;
  const candW = (pkg.candidateWebsites || []).length;
  const props = (pkg.associated_properties || []).length;
  const co = (pkg.co_owners || []).length;
  const dQ = (pkg.direct_entity_queries || []).length;
  const mQ = (pkg.mailing_address_discovery_queries || []).length;
  const name = pkg.lead_owner_name || "(no name)";
  return [
    `${name} [${pkg.legal_entity_category}]`,
    `value=${pkg.lead_value_priority}`,
    `priority=${pkg.search_priority}`,
    `strategy=${pkg.search_strategy}`,
    `phones=${phones}/${candP}`,
    `emails=${emails}/${candE}`,
    `sites=${sites}/${candW}`,
    `props=${props}`,
    `co_owners=${co}`,
    `queries=${dQ}+${mQ}`,
  ].join(" | ");
}

export function previewSearchPackages(inputRows, options = {}) {
  const pkgs = buildSearchPackages(inputRows, options);
  return pkgs.map(summarizeSearchPackage).join("\n");
}

// ─── Aggregation + reporting ───────────────────────────────────────────────

// Pure rollup helper for the dev preview script (and any future debug UI).
// Returns the bucket counts the user wants to inspect at a glance.
export function aggregateSearchPackageStats(packages) {
  const list = Array.isArray(packages) ? packages : [];
  const stats = {
    total: list.length,
    // by_priority kept for backward compat; mirrors by_search_need.
    by_priority: { high: 0, medium: 0, low: 0, skip: 0 },
    by_search_need: { high: 0, medium: 0, low: 0, skip: 0 },
    by_lead_value: { high: 0, medium: 0, low: 0 },
    by_strategy: {},
    by_category: {},
    with_existing_phone: 0,
    with_existing_email: 0,
    with_existing_website: 0,
    numbered_companies: 0,
    individuals: 0,
    with_mailing_address: 0,
    total_properties: 0,
  };
  for (const pkg of list) {
    if (!pkg) continue;
    const pri = pkg.search_need_priority || pkg.search_priority;
    if (Object.prototype.hasOwnProperty.call(stats.by_priority, pri)) {
      stats.by_priority[pri]++;
      stats.by_search_need[pri]++;
    }
    const val = pkg.lead_value_priority;
    if (Object.prototype.hasOwnProperty.call(stats.by_lead_value, val)) {
      stats.by_lead_value[val]++;
    }
    const strat = pkg.search_strategy || "(unknown)";
    stats.by_strategy[strat] = (stats.by_strategy[strat] || 0) + 1;
    const cat = pkg.legal_entity_category || "unknown";
    stats.by_category[cat] = (stats.by_category[cat] || 0) + 1;
    if ((pkg.existing_phones || []).length) stats.with_existing_phone++;
    if ((pkg.existing_emails || []).length) stats.with_existing_email++;
    if ((pkg.existing_websites || []).length) stats.with_existing_website++;
    if (cat === "numbered_company") stats.numbered_companies++;
    if (cat === "individual") stats.individuals++;
    if (pkg.mailing_address || pkg.mailing_postal_code) stats.with_mailing_address++;
    stats.total_properties += (pkg.associated_properties || []).length;
  }
  return stats;
}

// Detailed per-package row: name, category, priority, strategy, property
// count, existing-phone count, top direct query, top mailing-address query.
// Used by formatSearchPackageReport — kept as a separate export so callers
// (e.g. unit tests) can inspect the row shape directly.
export function formatSearchPackageRow(pkg) {
  if (!pkg) return "";
  const name = pkg.lead_owner_name || "(no name)";
  const cat = pkg.legal_entity_category;
  const pri = pkg.search_priority;
  const strat = pkg.search_strategy;
  const props = (pkg.associated_properties || []).length;
  const phones = (pkg.existing_phones || []).length;
  const emails = (pkg.existing_emails || []).length;
  const sites = (pkg.existing_websites || []).length;
  const dQ = (pkg.direct_entity_queries || []);
  const mQ = (pkg.mailing_address_discovery_queries || []);
  const dQHead = dQ.length ? `${dQ[0]}${dQ.length > 1 ? ` (+${dQ.length - 1})` : ""}` : "—";
  const mQHead = mQ.length ? `${mQ[0]}${mQ.length > 1 ? ` (+${mQ.length - 1})` : ""}` : "—";
  const val = pkg.lead_value_priority || "?";
  return [
    name,
    cat,
    `value=${val}`,
    `pri=${pri}`,
    `strat=${strat}`,
    `props=${props}`,
    `phones=${phones}`,
    `emails=${emails}`,
    `sites=${sites}`,
    `dQ=${dQHead}`,
    `mQ=${mQHead}`,
  ].join(" | ");
}

// Multi-line debug report: stats header + the top-N package rows. `topN`
// defaults to 20, matching the dev-script ask. Pass `0` for "all packages".
//
// Order: input order (buildSearchPackages already sorts by source_row_indices).
// The caller can sort packages differently before passing them in if needed.
export function formatSearchPackageReport(packages, options = {}) {
  const topN = Number.isFinite(options.topN) ? options.topN : 20;
  const list = Array.isArray(packages) ? packages : [];
  const stats = aggregateSearchPackageStats(list);

  const lines = [];
  lines.push("=== Search Package Stats ===");
  lines.push(`total: ${stats.total}`);
  lines.push(
    `lead_value: high=${stats.by_lead_value.high} medium=${stats.by_lead_value.medium} ` +
    `low=${stats.by_lead_value.low}`,
  );
  lines.push(
    `search_need: high=${stats.by_search_need.high} medium=${stats.by_search_need.medium} ` +
    `low=${stats.by_search_need.low} skip=${stats.by_search_need.skip}`,
  );
  lines.push(
    `existing: phone=${stats.with_existing_phone} email=${stats.with_existing_email} ` +
    `website=${stats.with_existing_website}`,
  );
  lines.push(
    `entities: numbered_company=${stats.numbered_companies} ` +
    `individual=${stats.individuals} with_mailing=${stats.with_mailing_address}`,
  );
  const catEntries = Object.entries(stats.by_category).sort((a, b) => b[1] - a[1]);
  if (catEntries.length) {
    lines.push("categories: " + catEntries.map(([k, v]) => `${k}=${v}`).join(" "));
  }
  const stratEntries = Object.entries(stats.by_strategy).sort((a, b) => b[1] - a[1]);
  if (stratEntries.length) {
    lines.push("strategies: " + stratEntries.map(([k, v]) => `${k}=${v}`).join(" "));
  }
  lines.push(`total_properties: ${stats.total_properties}`);

  const rows = topN > 0 ? list.slice(0, topN) : list;
  if (rows.length) {
    lines.push("");
    lines.push(`=== Top ${rows.length} Packages ===`);
    rows.forEach((pkg, idx) => {
      lines.push(`${String(idx + 1).padStart(3, " ")}. ${formatSearchPackageRow(pkg)}`);
    });
  }
  return lines.join("\n");
}

// ─── Targeted audits ───────────────────────────────────────────────────────
//
// auditSearchPackages slices a SearchPackage[] into the focused buckets the
// process-role-file dev CLI prints — top high-value packages without a phone,
// numbered companies / trusts without a phone, companies with a mailing
// address but no phone, and a list of suspicious classification/grouping
// issues that warrant manual review.
//
// Pure / zero-network / no I/O — same as the rest of the module.

function pkgHasAnyPhone(pkg) {
  for (const p of pkg.existing_phones || []) {
    if (normalizePhoneKey(p)) return true;
  }
  for (const c of pkg.candidatePhones || []) {
    if (normalizePhoneKey(c?.phone)) return true;
  }
  return false;
}

function pkgHasOwnerFilePhone(pkg) {
  for (const c of pkg.candidatePhones || []) {
    if (c?.source !== "file") continue;
    if (c?.relationship_to_lead_owner !== "owner") continue;
    if (normalizePhoneKey(c?.phone)) return true;
  }
  return false;
}

export function auditSearchPackages(packages, options = {}) {
  const list = Array.isArray(packages) ? packages : [];
  const topN = Number.isFinite(options.topN) ? options.topN : 25;

  const withoutPhone = list.filter((p) => !pkgHasAnyPhone(p));
  const withPhone = list.filter((p) => pkgHasAnyPhone(p));

  const topHighValueNoPhone = withoutPhone
    .filter((p) => p.lead_value_priority === "high")
    // Sort by property count then unit count so the largest portfolios float up.
    .sort((a, b) => {
      const ap = (a.associated_properties || []).length;
      const bp = (b.associated_properties || []).length;
      if (bp !== ap) return bp - ap;
      const au = (a.associated_properties || []).reduce((s, x) => s + (Number(x?.units) || 0), 0);
      const bu = (b.associated_properties || []).reduce((s, x) => s + (Number(x?.units) || 0), 0);
      return bu - au;
    })
    .slice(0, topN);

  const numberedNoPhone = withoutPhone.filter((p) => p.legal_entity_category === "numbered_company");
  const trustsNoPhone = withoutPhone.filter((p) => p.legal_entity_category === "trust");
  const companiesWithMailingNoPhone = withoutPhone.filter(
    (p) => p.is_searchable_entity && (p.mailing_address || p.mailing_postal_code),
  );

  // ─ Suspicious / classification issues ─
  const suspicious = [];

  // Building-phone leak: package has file phones but ALL of them are
  // building-relationship — the search-strategy might use_file_phone even
  // though we don't actually have an owner-direct line.
  for (const p of list) {
    const fileCands = (p.candidatePhones || []).filter((c) => c?.source === "file");
    if (!fileCands.length) continue;
    const ownerFile = fileCands.filter((c) => c.relationship_to_lead_owner === "owner");
    if (ownerFile.length === 0) {
      suspicious.push({
        kind: "building_phone_only",
        package: p,
        detail: `only building-relationship file phones (${fileCands.length}); no owner-direct file phone`,
      });
    }
  }

  // Address-aware duplicate detection: same-name packages at DIFFERENT
  // mailing addresses. This is INFORMATIONAL, not suspicious — it's the
  // legitimate "two entities share a name but mail to different places"
  // case. Same-address duplicates never appear here because they're already
  // merged into a single package upstream by buildSearchPackages.
  //
  // Surfaced via package.duplicate_different_address (set in
  // buildSearchPackages's second pass), and re-exposed here as a top-level
  // audit field so the dev CLI can list them under their own header rather
  // than mixed into "suspicious".
  const duplicateDifferentAddress = list.filter((p) => p.duplicate_different_address);

  // Numbered company with no mailing address — fully unsearchable.
  for (const p of list) {
    if (p.legal_entity_category !== "numbered_company") continue;
    if (p.mailing_address || p.mailing_postal_code) continue;
    suspicious.push({
      kind: "numbered_company_no_mailing",
      package: p,
      detail: "numbered company with no mailing address — needs manual review",
    });
  }

  // Individual flagged high-value — usually intentional (portfolio individual)
  // but worth surfacing so the user can sanity-check.
  for (const p of list) {
    if (p.legal_entity_category !== "individual") continue;
    if (p.lead_value_priority !== "high") continue;
    suspicious.push({
      kind: "individual_high_value",
      package: p,
      detail: `individual marked high-value due to portfolio size (${(p.associated_properties || []).length} properties)`,
    });
  }

  // Tiered enrichment buckets.
  // already_has_phone: owner-direct file phone found — no enrichment needed.
  // skipped_unsearchable: search_eligible=false for other reason (junk/no signal).
  // eligibleWithoutPhone: search_eligible + no owner-direct phone; includes
  //   packages that only have a building-relationship phone (still need the
  //   owner's direct line).
  const alreadyHasPhone = list.filter(pkgHasOwnerFilePhone);
  const skippedUnsearchable = list.filter(
    (p) => !p.search_eligible && !pkgHasOwnerFilePhone(p),
  );
  const eligibleWithoutPhone = list.filter(
    (p) => p.search_eligible && !pkgHasOwnerFilePhone(p),
  );
  const highTargets = eligibleWithoutPhone
    .filter((p) => p.enrichment_search_priority === "high")
    .sort(enrichmentSortComparator);
  const mediumTargets = eligibleWithoutPhone
    .filter((p) => p.enrichment_search_priority === "medium")
    .sort(enrichmentSortComparator);
  const lowTargets = eligibleWithoutPhone
    .filter((p) => p.enrichment_search_priority === "low")
    .sort(enrichmentSortComparator);

  return {
    total: list.length,
    with_phone: withPhone.length,
    without_phone: withoutPhone.length,
    with_owner_file_phone: list.filter(pkgHasOwnerFilePhone).length,
    top_high_value_without_phone: topHighValueNoPhone,
    numbered_companies_without_phone: numberedNoPhone,
    trusts_without_phone: trustsNoPhone,
    companies_with_mailing_no_phone: companiesWithMailingNoPhone,
    duplicate_different_address: duplicateDifferentAddress,
    suspicious,
    // Tiered enrichment buckets — use these for enrichment target selection
    // instead of top_high_value_without_phone.
    already_has_phone: alreadyHasPhone,
    skipped_unsearchable: skippedUnsearchable,
    high_priority_targets: highTargets,
    medium_priority_targets: mediumTargets,
    low_priority_targets: lowTargets,
    summary: {
      eligible_without_phone: eligibleWithoutPhone.length,
      already_has_phone: alreadyHasPhone.length,
      skipped_unsearchable: skippedUnsearchable.length,
      high_priority_targets: highTargets.length,
      medium_priority_targets: mediumTargets.length,
      low_priority_targets: lowTargets.length,
    },
  };
}
