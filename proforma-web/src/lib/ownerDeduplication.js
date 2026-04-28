// proforma-web/src/lib/ownerDeduplication.js
//
// Pure module for grouping search packages by owner identity so the
// orchestrator only fires ONE enrichment call per unique owner+address
// combination. Results are then fanned out to every grouped property.
//
// This is NOT prioritization — every unique owner gets equal effort.
// It simply avoids re-enriching the SAME owner N times when they own
// multiple properties in the same import batch.

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip diacritics from a string (é → e, ô → o, etc.).
 */
function stripDiacritics(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Corporate suffix pattern — strip these from owner names so
// "GESTION XYZ INC." and "GESTION XYZ LTÉE" are the same owner.
// Ordered longest-first to avoid partial matches.
const CORPORATE_SUFFIX_RE = /\b(corporation|fiducie|trust|senc|enrg|ltée|ltee|corp|enrg|enr|reg|snc|sec|llp|llc|inc|ltd|enr|reg|co|sa)\b\.?/gi;

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Normalize an owner name to a stable deduplication key.
 * - Lowercase
 * - Strip diacritics
 * - Strip corporate suffixes
 * - Collapse whitespace
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeOwnerKey(name) {
  if (!name || typeof name !== "string") return "";
  return stripDiacritics(name)
    .toLowerCase()
    .replace(CORPORATE_SUFFIX_RE, " ")
    .replace(/[^\w\s]/g, " ") // punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize an address to a stable deduplication key.
 * Uses postalCode as the primary discriminator; falls back to (street, city)
 * when postalCode is absent.
 *
 * @param {{ street?: string, city?: string, postalCode?: string }} addr
 * @returns {string}
 */
export function normalizeAddressKey({ street = "", city = "", postalCode = "" } = {}) {
  const normalize = (s) => stripDiacritics(String(s || "")).toLowerCase().replace(/\s+/g, "").trim();

  const pc = normalize(postalCode);
  if (pc) return `pc:${pc}`;

  const st = normalize(street);
  const ct = normalize(city);
  return `addr:${st}|${ct}`;
}

/**
 * Combine normalized owner + normalized address into a single group key.
 *
 * @param {{ lead_owner_name?: string, mailing_address?: string, mailing_city?: string, postal_code?: string, [k:string]:any }} pkg
 * @returns {string}
 */
export function groupKey(pkg) {
  if (!pkg || typeof pkg !== "object") return "";
  const ownerPart = normalizeOwnerKey(pkg.lead_owner_name || "");
  const addrPart = normalizeAddressKey({
    street: pkg.mailing_address || pkg.street || "",
    city: pkg.mailing_city || pkg.city || "",
    postalCode: pkg.postal_code || pkg.postalCode || pkg.mailing_postal_code || "",
  });
  return `${ownerPart}__${addrPart}`;
}

/**
 * Group an array of package entries by owner+address identity.
 *
 * @param {Array<{ packageKey: string, package: object }>} packages
 * @returns {{ groups: Map<string, Array<{packageKey:string,package:object}>>, representatives: Array<{packageKey:string,package:object}> }}
 *   `representatives` contains exactly ONE entry per group (the first seen).
 */
export function groupPackagesByOwner(packages) {
  const groups = new Map();
  const representatives = [];

  for (const entry of packages) {
    if (!entry || !entry.package) continue;
    const key = groupKey(entry.package);
    if (!groups.has(key)) {
      groups.set(key, []);
      representatives.push(entry);
    }
    groups.get(key).push(entry);
  }

  return { groups, representatives };
}

// Fields that belong to the PROPERTY side (not the owner) — each grouped
// member keeps its own values for these.
const PROPERTY_FIELDS = new Set([
  "propertyId",
  "address",
  "mailing_address",
  "mailing_city",
  "mailing_postal_code",
  "postal_code",
  "postalCode",
  "street",
  "city",
  "units",
  "unit_count",
  "lots",
  "lot_number",
  "lot_numbers",
  "civic_number",
  "municipal_number",
  "property_address",
]);

/**
 * Fan out a single enrichment result to every member of its deduplication group.
 * Property-side fields are preserved from each member's own package data.
 * Owner-side fields (phone, email, evidence, status, etc.) are shared.
 *
 * @param {object} result  The enrichment result for the representative.
 * @param {Array<{packageKey:string,package:object}>} group  All members of the group.
 * @returns {Map<string, object>}  packageKey → enriched result
 */
export function fanOutResult(result, group) {
  const out = new Map();
  const [representative, ...others] = group;

  // Representative gets the result as-is
  if (representative) {
    out.set(representative.packageKey, { ...result });
  }

  // Each non-representative member gets a clone with property-side fields
  // preserved from its own package and dedup evidence appended.
  for (const member of others) {
    const memberResult = { ...result };

    // Restore property-side fields from the member's own package data
    for (const field of PROPERTY_FIELDS) {
      if (field in member.package) {
        memberResult[field] = member.package[field];
      }
    }

    // Add dedup evidence so the UI can explain why this property got a phone
    // without a direct search
    memberResult.evidence = [
      ...(result.evidence || []),
      `deduped_from_representative: ${representative?.packageKey || "unknown"}`,
    ];

    out.set(member.packageKey, memberResult);
  }

  return out;
}
