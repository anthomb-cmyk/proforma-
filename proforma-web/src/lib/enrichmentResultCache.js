// proforma-web/src/lib/enrichmentResultCache.js
//
// Cross-session enrichment result cache backed by localStorage.
//
// Cache key strategy:
//   Primary: neq:<NEQ>       when a NEQ is present on the result/package
//   Fallback: oa:<normalizeOwnerKey(name)>::<normalizeAddressKey(addr)>
//
// Storage: single localStorage key "pf_enrichment_result_cache_v1"
//   holding a JSON object of { [cacheKey]: { result, cachedAt } }.
//
// LRU trim: when total entries > 5000, drop the 1000 oldest.

import { normalizeOwnerKey, normalizeAddressKey } from "./ownerDeduplication.js";

const STORAGE_KEY = "pf_enrichment_result_cache_v1";
const MAX_ENTRIES = 5000;
const TRIM_TO = MAX_ENTRIES - 1000; // keep newest 4000 after trim
const DEFAULT_MAX_AGE_DAYS = 60;

// ─── NEQ extraction ───────────────────────────────────────────────────────────

const NEQ_RE = /\bNEQ[:\s=]*(\d{10}|\d{4}[-\s]\d{4}[-\s]\d{2})\b/i;

function extractNEQ(pkg) {
  // Look in result fields and evidence array
  const candidates = [
    pkg?.enterpriseNumber,
    pkg?.neq,
    pkg?.NEQ,
    // Also scan evidence strings for a NEQ:XXXXX marker
    ...(Array.isArray(pkg?.evidence) ? pkg.evidence : []),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const m = String(c).match(NEQ_RE);
    if (m) return m[1].replace(/[-\s]/g, "");
    // Plain 10-digit number
    if (/^\d{10}$/.test(String(c).trim())) return String(c).trim();
  }
  return null;
}

// ─── Cache key helpers ────────────────────────────────────────────────────────

/**
 * Compute the cache key for a package (or enriched result).
 * Returns empty string when neither NEQ nor owner+address is available.
 *
 * @param {object} pkg
 * @returns {string}
 */
export function cacheKey(pkg) {
  if (!pkg || typeof pkg !== "object") return "";

  const neq = extractNEQ(pkg);
  if (neq) return `neq:${neq}`;

  const ownerPart = normalizeOwnerKey(pkg.lead_owner_name || "");
  if (!ownerPart) return "";

  const addrPart = normalizeAddressKey({
    street: pkg.mailing_address || pkg.street || "",
    city: pkg.mailing_city || pkg.city || "",
    postalCode: pkg.postal_code || pkg.postalCode || pkg.mailing_postal_code || "",
  });

  return `oa:${ownerPart}::${addrPart}`;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function readStore() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage quota exceeded — fail silently
  }
}

/**
 * Trim the oldest entries when the store exceeds MAX_ENTRIES.
 * Drops 1000 oldest entries to avoid thrashing on every write.
 *
 * @param {object} store  Mutated in-place.
 */
function trimIfNeeded(store) {
  const keys = Object.keys(store);
  if (keys.length <= MAX_ENTRIES) return;

  // Sort by cachedAt ascending (oldest first)
  keys.sort((a, b) => (store[a]?.cachedAt || 0) - (store[b]?.cachedAt || 0));
  const toDelete = keys.slice(0, keys.length - TRIM_TO);
  for (const k of toDelete) delete store[k];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up a cached enrichment result for the given package.
 *
 * @param {object} pkg
 * @param {{ maxAgeDays?: number }} [opts]
 * @returns {{ result: object, cachedAt: number, hit: true } | { hit: false }}
 */
export function getCachedResult(pkg, opts = {}) {
  const key = cacheKey(pkg);
  if (!key) return { hit: false };

  const store = readStore();
  const entry = store[key];
  if (!entry) return { hit: false };

  const maxAgeMs = (opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const age = Date.now() - (entry.cachedAt || 0);
  if (age > maxAgeMs) return { hit: false };

  return { result: entry.result, cachedAt: entry.cachedAt, hit: true };
}

/**
 * Store an enrichment result for a package.
 * No-op when the cache key cannot be computed.
 *
 * @param {object} pkg
 * @param {object} result
 */
export function cacheResult(pkg, result) {
  const key = cacheKey(pkg);
  if (!key) return;

  const store = readStore();
  store[key] = { result, cachedAt: Date.now() };
  trimIfNeeded(store);
  writeStore(store);
}

/**
 * Remove the cache entry for a package.
 * Used by "Force re-enrich".
 *
 * @param {object} pkg
 */
export function clearCachedResult(pkg) {
  const key = cacheKey(pkg);
  if (!key) return;
  const store = readStore();
  delete store[key];
  writeStore(store);
}

/**
 * Clear all cached entries.
 * Used by a "Reset cache" admin action.
 */
export function clearAllCached() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Return summary statistics for the current cache.
 *
 * @returns {{ entries: number, oldestAt: number|null, newestAt: number|null }}
 */
export function cacheStats() {
  const store = readStore();
  const entries = Object.values(store);
  if (!entries.length) return { entries: 0, oldestAt: null, newestAt: null };

  let oldestAt = Infinity;
  let newestAt = -Infinity;
  for (const e of entries) {
    const t = e?.cachedAt || 0;
    if (t < oldestAt) oldestAt = t;
    if (t > newestAt) newestAt = t;
  }

  return {
    entries: entries.length,
    oldestAt: oldestAt === Infinity ? null : oldestAt,
    newestAt: newestAt === -Infinity ? null : newestAt,
  };
}
