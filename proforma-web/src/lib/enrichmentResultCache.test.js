// proforma-web/src/lib/enrichmentResultCache.test.js
//
// Tests for enrichmentResultCache.js.
// Uses a localStorage mock since tests run in Node (no browser).

import test from "node:test";
import assert from "node:assert/strict";

// ─── localStorage mock ────────────────────────────────────────────────────────
let _store = {};
globalThis.localStorage = {
  getItem: (k) => _store[k] ?? null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: (k) => { delete _store[k]; },
  clear: () => { _store = {}; },
};

function resetStorage() { _store = {}; }

// ─── Import under test ────────────────────────────────────────────────────────
// Dynamic import to ensure localStorage mock is in place before the module loads.
const {
  cacheKey,
  getCachedResult,
  cacheResult,
  clearCachedResult,
  clearAllCached,
  cacheStats,
} = await import("./enrichmentResultCache.js");

/* ──────────────────────────────────────────────────────────────────────────── */

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
/*  1. Round-trip: cacheResult then getCachedResult returns the same data       */
/* ──────────────────────────────────────────────────────────────────────────── */

test("round-trip: cacheResult then getCachedResult returns result + cachedAt", () => {
  resetStorage();
  cacheResult(PKG_NO_NEQ, RESULT_A);
  const hit = getCachedResult(PKG_NO_NEQ);
  assert.equal(hit.hit, true);
  assert.deepEqual(hit.result, RESULT_A);
  assert.ok(typeof hit.cachedAt === "number" && hit.cachedAt > 0, "cachedAt should be a positive number");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  2. Expiry: cachedAt older than maxAgeDays → hit: false                      */
/* ──────────────────────────────────────────────────────────────────────────── */

test("expiry: entry older than maxAgeDays returns hit: false", () => {
  resetStorage();
  const key = cacheKey(PKG_NO_NEQ);

  // Manually plant an old entry
  const store = { [key]: { result: RESULT_A, cachedAt: Date.now() - (61 * 24 * 60 * 60 * 1000) } };
  _store["pf_enrichment_result_cache_v1"] = JSON.stringify(store);

  const hit = getCachedResult(PKG_NO_NEQ, { maxAgeDays: 60 });
  assert.equal(hit.hit, false);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  3. NEQ key takes precedence over owner+address key                          */
/* ──────────────────────────────────────────────────────────────────────────── */

test("NEQ key takes precedence over owner+address key", () => {
  resetStorage();
  const k = cacheKey(PKG_WITH_NEQ);
  assert.ok(k.startsWith("neq:"), `expected neq: prefix, got "${k}"`);
  assert.equal(k, "neq:1234567890");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  4. Owner+address fallback when no NEQ                                       */
/* ──────────────────────────────────────────────────────────────────────────── */

test("owner+address fallback when no NEQ", () => {
  const k = cacheKey(PKG_NO_NEQ);
  assert.ok(k.startsWith("oa:"), `expected oa: prefix, got "${k}"`);
  assert.ok(k.includes("abc"), "normalized owner name should be in key");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  5. clearCachedResult removes only the targeted entry                        */
/* ──────────────────────────────────────────────────────────────────────────── */

test("clearCachedResult removes only the targeted entry", () => {
  resetStorage();
  const RESULT_B = { status: "no_contact_found", bestPhone: null };
  cacheResult(PKG_NO_NEQ, RESULT_A);
  cacheResult(PKG_WITH_NEQ, RESULT_B);

  clearCachedResult(PKG_NO_NEQ);

  assert.equal(getCachedResult(PKG_NO_NEQ).hit, false, "targeted entry should be gone");
  assert.equal(getCachedResult(PKG_WITH_NEQ).hit, true, "other entry should remain");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  6. clearAllCached empties everything                                        */
/* ──────────────────────────────────────────────────────────────────────────── */

test("clearAllCached empties all entries", () => {
  resetStorage();
  cacheResult(PKG_NO_NEQ, RESULT_A);
  cacheResult(PKG_WITH_NEQ, { status: "needs_review" });
  clearAllCached();
  assert.equal(getCachedResult(PKG_NO_NEQ).hit, false);
  assert.equal(getCachedResult(PKG_WITH_NEQ).hit, false);
  assert.equal(cacheStats().entries, 0);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  7. >5000 entry trim drops oldest 1000                                       */
/* ──────────────────────────────────────────────────────────────────────────── */

test(">5000 entries: trim drops the 1000 oldest when adding the 5001st", () => {
  resetStorage();

  // Plant 5001 entries with known cachedAt values (oldest first = index 0).
  const store = {};
  for (let i = 0; i < 5001; i++) {
    // key i has cachedAt = i (so key 0 is oldest)
    store[`synthetic:${i}`] = { result: { i }, cachedAt: i };
  }
  _store["pf_enrichment_result_cache_v1"] = JSON.stringify(store);

  // cacheResult on a new key triggers a read+write, which calls trimIfNeeded.
  cacheResult({ lead_owner_name: "Trigger Trim Inc.", mailing_address: "1 rue Test", mailing_city: "QC" },
    { status: "ready_to_call" });

  const stats = cacheStats();
  // After trim: 5001 + 1 = 5002 entries → trim to 4000 → 4001 (4000 synthetic + 1 new)
  // But trimIfNeeded runs BEFORE writing, so store has 5001 entries, trim to 4000, then +1 = 4001.
  assert.ok(stats.entries <= 4001, `expected ≤4001 entries after trim, got ${stats.entries}`);
  assert.ok(stats.entries >= 3999, `expected ≥3999 entries after trim, got ${stats.entries}`);
  // With 5001 old entries + 1 new = 5002 entries, trim drops oldest (5002-4000=1002) entries
  // leaving entries with cachedAt >= 1002 alive. Indices 0-1001 are deleted.
  const rawStore = JSON.parse(_store["pf_enrichment_result_cache_v1"] || "{}");
  assert.ok(!rawStore["synthetic:0"], "synthetic:0 (oldest) should have been trimmed");
  assert.ok(!rawStore["synthetic:999"], "synthetic:999 should have been trimmed");
  assert.ok(!rawStore["synthetic:1001"], "synthetic:1001 should have been trimmed");
  assert.ok(rawStore["synthetic:2000"], "synthetic:2000 should have survived");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  8. Empty cacheKey (no NEQ + no owner) → no-op                              */
/* ──────────────────────────────────────────────────────────────────────────── */

test("empty cacheKey: caching is a no-op and getCachedResult returns hit: false", () => {
  resetStorage();
  const emptyPkg = {};
  const k = cacheKey(emptyPkg);
  assert.equal(k, "", "cacheKey should be empty string");

  cacheResult(emptyPkg, RESULT_A); // no-op
  const hit = getCachedResult(emptyPkg);
  assert.equal(hit.hit, false);
  assert.equal(cacheStats().entries, 0);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  9. cacheStats returns correct counts                                        */
/* ──────────────────────────────────────────────────────────────────────────── */

test("cacheStats returns correct entry count and timestamps", () => {
  resetStorage();
  cacheResult(PKG_NO_NEQ, RESULT_A);
  cacheResult(PKG_WITH_NEQ, { status: "needs_review" });
  const stats = cacheStats();
  assert.equal(stats.entries, 2);
  assert.ok(typeof stats.oldestAt === "number", "oldestAt should be a number");
  assert.ok(typeof stats.newestAt === "number", "newestAt should be a number");
  assert.ok(stats.newestAt >= stats.oldestAt, "newestAt should be >= oldestAt");
});
