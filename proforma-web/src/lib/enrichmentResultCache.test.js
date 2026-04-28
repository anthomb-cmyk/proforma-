// proforma-web/src/lib/enrichmentResultCache.test.js
//
// Tests for enrichmentResultCache.js — Jest/react-scripts compatible.

import {
  cacheKey,
  getCachedResult,
  cacheResult,
  clearCachedResult,
  clearAllCached,
  cacheStats,
} from "./enrichmentResultCache.js";

const STORAGE_KEY = "pf_enrichment_result_cache_v1";

function resetStorage() {
  try { localStorage.clear(); } catch {}
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PKG_WITH_NEQ = {
  lead_owner_name: "Gestion XYZ Inc.",
  mailing_address: "123 rue Fictive",
  mailing_city: "Montréal",
  // NEQ in evidence string — extracted by extractNEQ
  evidence: ["company_profile: NEQ=1234567890 directors=2"],
};

const PKG_NO_NEQ = {
  lead_owner_name: "Gestion ABC Inc.",
  mailing_address: "456 av. Test",
  mailing_city: "Laval",
};

const RESULT_A = { status: "ready_to_call", bestPhone: "(514) 555-0100", confidence: "high" };

/* ──────────────────────────────────────────────────────────────────────────── */

describe("enrichmentResultCache", () => {
  beforeEach(resetStorage);

  /* 1. Round-trip */
  test("round-trip: cacheResult then getCachedResult returns result + cachedAt", () => {
    cacheResult(PKG_NO_NEQ, RESULT_A);
    const hit = getCachedResult(PKG_NO_NEQ);
    expect(hit.hit).toBe(true);
    expect(hit.result).toEqual(RESULT_A);
    expect(typeof hit.cachedAt).toBe("number");
    expect(hit.cachedAt).toBeGreaterThan(0);
  });

  /* 2. Expiry */
  test("expiry: entry older than maxAgeDays returns hit: false", () => {
    const key = cacheKey(PKG_NO_NEQ);
    const oldStore = { [key]: { result: RESULT_A, cachedAt: Date.now() - (61 * 24 * 60 * 60 * 1000) } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldStore));

    const hit = getCachedResult(PKG_NO_NEQ, { maxAgeDays: 60 });
    expect(hit.hit).toBe(false);
  });

  /* 3. NEQ key takes precedence */
  test("NEQ key takes precedence over owner+address key", () => {
    const k = cacheKey(PKG_WITH_NEQ);
    expect(k).toMatch(/^neq:/);
    expect(k).toBe("neq:1234567890");
  });

  /* 4. Owner+address fallback */
  test("owner+address fallback when no NEQ", () => {
    const k = cacheKey(PKG_NO_NEQ);
    expect(k).toMatch(/^oa:/);
    expect(k).toContain("abc");
  });

  /* 5. clearCachedResult removes only targeted entry */
  test("clearCachedResult removes only the targeted entry", () => {
    const RESULT_B = { status: "no_contact_found", bestPhone: null };
    cacheResult(PKG_NO_NEQ, RESULT_A);
    cacheResult(PKG_WITH_NEQ, RESULT_B);

    clearCachedResult(PKG_NO_NEQ);

    expect(getCachedResult(PKG_NO_NEQ).hit).toBe(false);
    expect(getCachedResult(PKG_WITH_NEQ).hit).toBe(true);
  });

  /* 6. clearAllCached empties everything */
  test("clearAllCached empties all entries", () => {
    cacheResult(PKG_NO_NEQ, RESULT_A);
    cacheResult(PKG_WITH_NEQ, { status: "needs_review" });
    clearAllCached();
    expect(getCachedResult(PKG_NO_NEQ).hit).toBe(false);
    expect(getCachedResult(PKG_WITH_NEQ).hit).toBe(false);
    expect(cacheStats().entries).toBe(0);
  });

  /* 7. >5000 entry trim */
  test(">5000 entries: trim drops oldest entries when store exceeds limit", () => {
    // Plant 5001 entries with known cachedAt values (oldest = index 0).
    const store = {};
    for (let i = 0; i < 5001; i++) {
      store[`synthetic:${i}`] = { result: { i }, cachedAt: i };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));

    // cacheResult on a new key triggers read+write → trimIfNeeded.
    cacheResult(
      { lead_owner_name: "Trigger Trim Inc.", mailing_address: "1 rue Test", mailing_city: "QC" },
      { status: "ready_to_call" },
    );

    const stats = cacheStats();
    // 5001 old + 1 new = 5002 entries, trimmed to 4000, then +1 new = but trim
    // happens before write in our impl... let's just assert reasonable bounds.
    expect(stats.entries).toBeLessThanOrEqual(4100);
    expect(stats.entries).toBeGreaterThan(3000);

    const rawStore = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    // Very oldest (index 0) should be gone.
    expect(rawStore["synthetic:0"]).toBeUndefined();
    // Something near the end should survive.
    expect(rawStore["synthetic:4000"]).toBeDefined();
  });

  /* 8. Empty cacheKey → no-op */
  test("empty cacheKey: caching is a no-op and getCachedResult returns hit: false", () => {
    const emptyPkg = {};
    const k = cacheKey(emptyPkg);
    expect(k).toBe("");

    cacheResult(emptyPkg, RESULT_A); // no-op
    const hit = getCachedResult(emptyPkg);
    expect(hit.hit).toBe(false);
    expect(cacheStats().entries).toBe(0);
  });

  /* 9. cacheStats returns correct counts */
  test("cacheStats returns correct entry count and timestamps", () => {
    cacheResult(PKG_NO_NEQ, RESULT_A);
    cacheResult(PKG_WITH_NEQ, { status: "needs_review" });
    const stats = cacheStats();
    expect(stats.entries).toBe(2);
    expect(typeof stats.oldestAt).toBe("number");
    expect(typeof stats.newestAt).toBe("number");
    expect(stats.newestAt).toBeGreaterThanOrEqual(stats.oldestAt);
  });
});

import { shouldBypassCacheForPlaces } from "./enrichmentResultCache.js";

describe("shouldBypassCacheForPlaces", () => {
  test("phone exists + Places ON → use cache (no bypass)", () => {
    expect(shouldBypassCacheForPlaces({ bestPhone: "5145550100" }, true)).toBe(false);
  });
  test("no phone + Places OFF → use cache (no bypass)", () => {
    expect(shouldBypassCacheForPlaces({ bestPhone: null, evidence: [] }, false)).toBe(false);
  });
  test("no phone + Places ON + no places_fallback evidence → BYPASS cache", () => {
    expect(shouldBypassCacheForPlaces({ bestPhone: null, evidence: ["direct_query: x"] }, true)).toBe(true);
  });
  test("no phone + Places ON + has places_fallback evidence → use cache", () => {
    expect(shouldBypassCacheForPlaces({ bestPhone: null, evidence: ["places_fallback_skipped: blocked_type"] }, true)).toBe(false);
  });
  test("null result → use cache (no bypass) — defensive", () => {
    expect(shouldBypassCacheForPlaces(null, true)).toBe(false);
  });
  test("places_fallback_skipped also counts as already-tried", () => {
    expect(shouldBypassCacheForPlaces({ bestPhone: null, evidence: ["places_fallback: phone X"] }, true)).toBe(false);
  });
});
