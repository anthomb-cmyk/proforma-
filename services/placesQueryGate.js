// services/placesQueryGate.js
//
// Pure helpers that decide WHEN (and HOW) Google Places fallback can be
// safely used in the new package-based contact-enrichment flow. This module
// performs zero network I/O — it holds eligibility predicates and query-
// shape decisions that callers (the future enrichment pipeline) consult
// before constructing any Places request.
//
// Scope contract
// ──────────────
//   • This module does NOT issue Places calls.
//   • This module does NOT modify the old row-based /api/phone-lookup flow
//     (services/phoneEnrichment.js). That code path keeps using its own
//     copy of the same constants and predicates.
//   • This module is the single source of truth for the package-based
//     gating rules; the old row-based flow has its own row-based gating
//     (normalizeRow, isResidential, businessNames filtering) which is NOT
//     replicated here. The two paths are intentionally separate until
//     parity is verified end-to-end in a later PR.
//
// Why a separate module
// ─────────────────────
// The package shape is fundamentally different from the raw-row shape:
//   • A package has classified fields (lead_owner_name, legal_entity_category,
//     mailing_*, mailingAddresses[], search_eligibility, …) — no header guessing.
//   • A package represents an aggregated entity, not a single property row,
//     so multi-property owners share one set of decisions.
//   • Numbered companies in the package model carry a mailing address that
//     CAN anchor a Places query — the row-based flow drops them as junk
//     because the row never carries a clean owner-mailing field. This is an
//     INTENTIONAL difference, called out in `isPackagePlacesEligible` below.
//
// Parity requirement
// ──────────────────
// BLOCKED_PLACE_TYPES below MUST stay in sync with the same Set in
// services/phoneEnrichment.js. A parity test in placesQueryGate.test.js
// imports both via __testables__ and asserts they hold the exact same
// members. When you add or remove a place type, edit BOTH files — and the
// parity test will scream if you forget.

import {
  isJunkBusinessName,
  looksLikePersonalName,
  cleanText,
} from "./phoneEnrichment.js";

// ─── Blocked place types ────────────────────────────────────────────────────

// Place types that a Places result must NOT have. Mirrors the same set in
// phoneEnrichment.js; see "Parity requirement" above. Government, civic, and
// pure-geography entities — none of them represent a private business that
// could legitimately answer a phone for the property owner.
export const BLOCKED_PLACE_TYPES = new Set([
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

/**
 * Return true when at least one entry of `types` is in BLOCKED_PLACE_TYPES.
 * Safe against non-array inputs (returns false).
 */
export function hasBlockedType(types) {
  if (!Array.isArray(types)) return false;
  return types.some((t) => BLOCKED_PLACE_TYPES.has(t));
}

// ─── Utilisation / residential gating ───────────────────────────────────────

// Québec rôle "Utilisation prédominante" values that mark a property as
// purely residential (rental dwellings). For these, the building address is
// the address of TENANTS — not the owner — so it must never be queried as
// a Places anchor.
const RESIDENTIAL_UTIL_RE = /^logement(s)?$/i;

/**
 * Return true when the utilisation value indicates a pure residential
 * rental property (Québec's "Logement" classification).
 */
export function isResidentialUtilisation(utilisation) {
  const t = cleanText(utilisation);
  return !!t && RESIDENTIAL_UTIL_RE.test(t.trim());
}

/**
 * Return true when the utilisation value indicates a commercial / mixed-use
 * property whose address is plausibly the owner's place of business.
 *
 * "Commercial" here is "anything not pure-residential" — we deliberately
 * don't enumerate every utilisation code. If utilisation is empty/unknown we
 * treat it as commercial-eligible (caller still has to pass other gates).
 */
export function isCommercialUtilisation(utilisation) {
  return !isResidentialUtilisation(utilisation);
}

// ─── Numbered-company detection (package context) ──────────────────────────

// Mirrors searchPackage.js:NUMBERED_RE. We classify based on legal_entity_category
// when present (preferred), but also accept a name-only check for callers that
// haven't run classifyLegalEntity yet.
const NUMBERED_NAME_RE =
  /^\s*\d{2,7}[-\s]?\d{0,7}\s*(?:qu[ée]bec|quebec|canada|qc|on|bc|ab)?\s*(?:inc|inc\.|ltée|ltee|ltd|ltée\.|limit[eé]e)\.?\s*$/i;

function isNumberedCompanyPkg(pkg) {
  if (pkg?.legal_entity_category === "numbered_company") return true;
  return NUMBERED_NAME_RE.test(String(pkg?.lead_owner_name || "").trim());
}

// ─── Categories that are eligible for package-based Places fallback ─────────

// Legal-entity categories (from searchPackage.classifyLegalEntity) that point
// to a real registered business — these are safe to query against Places
// even with no mailing address, because the entity is name-searchable.
const NAME_QUERYABLE_CATEGORIES = new Set([
  "immobilier",
  "investments",
  "holdings",
  "gestion",
  "society",
  "inc_ltee",
  "trust",
]);

// Categories that NEED a mailing address before Places becomes useful: the
// name alone isn't unique enough to land on the right business.
const MAILING_REQUIRED_CATEGORIES = new Set([
  "numbered_company",
]);

// ─── Mailing-address shape predicate ────────────────────────────────────────

// A mailing address is "useful" when it has at least a street OR (city + postal).
// Same gate buildMailingAddressDiscoveryQueries uses internally.
function hasUsefulMailingAddress(pkg) {
  if (!pkg) return false;

  const checkOne = (a) => {
    const street = String(a?.street || "").trim();
    const city = String(a?.city || "").trim();
    const postal = String(a?.postalCode || "").trim();
    return !!street || (!!city && !!postal);
  };

  // Prefer mailingAddresses[] (universal extractor output) when present.
  if (Array.isArray(pkg.mailingAddresses) && pkg.mailingAddresses.length > 0) {
    return pkg.mailingAddresses.some(checkOne);
  }

  // Fall back to flat mailing_* fields.
  const street = String(pkg.mailing_address || "").trim();
  const city = String(pkg.mailing_city || "").trim();
  const postal = String(pkg.mailing_postal_code || "").trim();
  return !!street || (!!city && !!postal);
}

// ─── Reliable-phone predicate ───────────────────────────────────────────────

// True when the package already carries an owner-relationship phone we trust.
// Places fallback exists to FILL IN missing phones; if a reliable owner phone
// is already known, we skip Places entirely.
//
// The package shape uses `candidatePhones[]` with `relationship_to_lead_owner`
// metadata. A "reliable" phone is one with relationship === "owner" (not
// "building", "directory", "mailing", "page", etc.) and source === "file".
function hasReliableOwnerPhone(pkg) {
  if (!pkg) return false;
  const cands = Array.isArray(pkg.candidatePhones) ? pkg.candidatePhones : [];
  return cands.some(
    (c) =>
      c &&
      c.relationship_to_lead_owner === "owner" &&
      (c.source === "file" || c.source === "verified"),
  );
}

// ─── Public API: package eligibility ────────────────────────────────────────

/**
 * Decide whether a search package is eligible for Google Places fallback.
 *
 * @param {object} pkg                       Search-package object
 * @param {object} [opts]
 * @param {boolean} [opts.skipIfHasReliablePhone=true]
 *   When true (default), packages that already have an owner-relationship
 *   "file"/"verified" phone are deemed not-eligible. Set to false in tests
 *   that want to inspect the eligibility logic in isolation.
 * @returns {{ eligible: boolean, reason: string }}
 *   `reason` documents why a package is eligible or not — used both by tests
 *   and by future telemetry to explain the gate decision in observability.
 */
export function isPackagePlacesEligible(pkg, opts = {}) {
  const { skipIfHasReliablePhone = true } = opts;

  if (!pkg || typeof pkg !== "object") {
    return { eligible: false, reason: "no_package" };
  }

  // 1. Name must be non-empty and non-junk. Junk = pure numbers, postal/civic,
  //    URL, email, municipal-only string, etc.
  const name = String(pkg.lead_owner_name || "").trim();
  if (!name) {
    return { eligible: false, reason: "empty_name" };
  }

  // 2. Search-eligibility flag must NOT explicitly mark the package as not
  //    searchable. Absence of the field means "unknown" → allow.
  if (
    pkg.search_eligibility === "skip_unsearchable" ||
    pkg.search_eligibility === "not_eligible"
  ) {
    return { eligible: false, reason: "not_search_eligible" };
  }

  // 3. Reliable-phone short-circuit (default behavior).
  if (skipIfHasReliablePhone && hasReliableOwnerPhone(pkg)) {
    return { eligible: false, reason: "already_has_reliable_phone" };
  }

  // 4. Junk-name screen. NOTE for reviewers: isJunkBusinessName from
  //    phoneEnrichment.js classifies any name matching its NUMBERED_CORP_RE
  //    as junk. The package-based path overrides that for true numbered
  //    companies WHEN they carry a mailing address (see step 6) — a numbered
  //    "9876-5432 QUÉBEC INC." company is registrable in Places when
  //    anchored to its registered office address.
  const numbered = isNumberedCompanyPkg(pkg);
  if (!numbered && isJunkBusinessName(name)) {
    return { eligible: false, reason: "junk_name" };
  }

  // 5. Generic individual rejection. Persons without a business indicator
  //    don't have a Places listing under their personal name.
  const cat = String(pkg.legal_entity_category || "").trim();
  if (cat === "individual") {
    return { eligible: false, reason: "individual_no_business" };
  }
  if (!cat && looksLikePersonalName(name)) {
    return { eligible: false, reason: "looks_like_personal_name" };
  }

  // 6. Numbered companies need a mailing address to be searchable on Places.
  //    The name alone (e.g. "9876-5432 Québec Inc.") is not unique enough
  //    for text search to land on the right registration.
  if (numbered || MAILING_REQUIRED_CATEGORIES.has(cat)) {
    if (!hasUsefulMailingAddress(pkg)) {
      return {
        eligible: false,
        reason: "numbered_company_without_mailing_address",
      };
    }
    return { eligible: true, reason: "numbered_company_with_mailing_address" };
  }

  // 7. Name-queryable categories (immobilier, gestion, holdings, …) are
  //    eligible by their entity name alone.
  if (NAME_QUERYABLE_CATEGORIES.has(cat)) {
    return { eligible: true, reason: `category_${cat}` };
  }

  // 8. Unknown category: allow ONLY if we have a mailing address to anchor
  //    on AND the name doesn't look like a personal name.
  if (hasUsefulMailingAddress(pkg)) {
    return { eligible: true, reason: "unknown_category_with_mailing_address" };
  }

  return { eligible: false, reason: "unknown_category_no_mailing" };
}

// ─── Query-shape decisions ──────────────────────────────────────────────────

/**
 * True when the building/property address is safe to use as a Places query
 * anchor. Building addresses point to TENANTS for residential-rental
 * properties, so we never query them.
 *
 * @param {object} pkg
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canUseBuildingAddressAsQuery(pkg) {
  const addr = String(pkg?.address || pkg?.building_address || "").trim();
  if (!addr) return { allowed: false, reason: "no_building_address" };

  if (isResidentialUtilisation(pkg?.utilisation)) {
    return { allowed: false, reason: "residential_utilisation" };
  }
  return { allowed: true, reason: "commercial_or_unknown_utilisation" };
}

/**
 * True when the owner mailing address is safe to use as a Places query
 * anchor. This is the preferred anchor for Places — owners are typically
 * findable at their registered office address.
 */
export function canUseMailingAddressAsQuery(pkg) {
  if (!hasUsefulMailingAddress(pkg)) {
    return { allowed: false, reason: "no_mailing_address" };
  }
  return { allowed: true, reason: "has_mailing_address" };
}

/**
 * True when the lead owner name is safe to use as a Places text-search
 * query (alone, with a city/province context). Numbered companies are
 * NOT name-only queryable — see isPackagePlacesEligible step 6.
 */
export function canUseOwnerNameAsQuery(pkg) {
  const name = String(pkg?.lead_owner_name || "").trim();
  if (!name) return { allowed: false, reason: "empty_name" };

  if (isNumberedCompanyPkg(pkg)) {
    return { allowed: false, reason: "numbered_company_needs_address_anchor" };
  }
  if (isJunkBusinessName(name)) {
    return { allowed: false, reason: "junk_name" };
  }
  if (looksLikePersonalName(name)) {
    return { allowed: false, reason: "personal_name" };
  }
  return { allowed: true, reason: "queryable_business_name" };
}

// ─── Test-only exports ──────────────────────────────────────────────────────

export const __testables__ = {
  NUMBERED_NAME_RE,
  NAME_QUERYABLE_CATEGORIES,
  MAILING_REQUIRED_CATEGORIES,
  RESIDENTIAL_UTIL_RE,
  hasUsefulMailingAddress,
  hasReliableOwnerPhone,
  isNumberedCompanyPkg,
};
