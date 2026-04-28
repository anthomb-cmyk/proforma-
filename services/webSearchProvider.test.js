// services/webSearchProvider.test.js
//
// Tests for the Brave rate limiter (Fix 1) and 429 retry (Fix 2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebSearchProvider } from "./webSearchProvider.js";

/* ── Fix 1: Brave provider serialises calls through module-level throttle ──── */

test("Brave provider serialises calls at >= minIntervalMs apart", async () => {
  const callTimestamps = [];

  // fetchImpl resolves immediately with a valid Brave-shaped response.
  const fakeFetch = async (_url, _opts) => {
    callTimestamps.push(Date.now());
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ web: { results: [] } }),
    };
  };

  const MIN_MS = 50; // low value so the test completes fast
  const provider = createWebSearchProvider({
    provider: "brave",
    braveKey: "test-key",
    fetchImpl: fakeFetch,
    minIntervalMs: MIN_MS,
  });

  // Fire 3 calls concurrently — they should be serialised by the throttle.
  await Promise.all([provider("query-a"), provider("query-b"), provider("query-c")]);

  assert.equal(callTimestamps.length, 3, "all 3 calls should have been made");

  // Each gap should be >= (MIN_MS - a small tolerance for timer imprecision).
  const TOLERANCE = 10; // ms
  const gap1 = callTimestamps[1] - callTimestamps[0];
  const gap2 = callTimestamps[2] - callTimestamps[1];

  assert.ok(
    gap1 >= MIN_MS - TOLERANCE,
    `gap between call 1 and 2 was ${gap1}ms, expected >= ${MIN_MS - TOLERANCE}ms`,
  );
  assert.ok(
    gap2 >= MIN_MS - TOLERANCE,
    `gap between call 2 and 3 was ${gap2}ms, expected >= ${MIN_MS - TOLERANCE}ms`,
  );
});

/* ── Fix 2: 429 first call → wait → retry succeeds ───────────────────────── */

test("Brave provider retries once on 429 and succeeds on second attempt", async () => {
  let callCount = 0;

  const fakeFetch = async (_url, _opts) => {
    callCount += 1;
    if (callCount === 1) {
      // First call: 429 with no Retry-After (will default to 2000ms).
      // We shorten the wait by providing a small Retry-After via header.
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => (h.toLowerCase() === "retry-after" ? "0" : null) },
        json: async () => ({}),
      };
    }
    // Second call: 200 OK
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ web: { results: [{ title: "T", description: "S", url: "https://x.com" }] } }),
    };
  };

  const provider = createWebSearchProvider({
    provider: "brave",
    braveKey: "test-key",
    fetchImpl: fakeFetch,
    minIntervalMs: 0, // disable throttle delay for this test
  });

  const result = await provider("test query");

  assert.equal(callCount, 2, "fetchImpl should have been called exactly twice (429 + retry)");
  assert.equal(result.ok, true, "result should be ok after successful retry");
  assert.equal(result.results.length, 1, "should return parsed results");
  assert.equal(result.results[0].title, "T");
});

/* ── Fix 2: 429 on both calls → returns BRAVE_RATE_LIMITED ────────────────── */

test("Brave provider returns BRAVE_RATE_LIMITED when both attempts are throttled", async () => {
  let callCount = 0;

  const fakeFetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 429,
      headers: { get: (h) => (h.toLowerCase() === "retry-after" ? "0" : null) },
      json: async () => ({}),
    };
  };

  const provider = createWebSearchProvider({
    provider: "brave",
    braveKey: "test-key",
    fetchImpl: fakeFetch,
    minIntervalMs: 0,
  });

  const result = await provider("rate-limited query");

  assert.equal(callCount, 2, "should have tried exactly twice");
  assert.equal(result.ok, false);
  assert.equal(result.error, "BRAVE_RATE_LIMITED");
});

/* ── Fix 1 coverage: Serper provider is NOT throttled through Brave queue ─── */

test("Serper provider is not affected by Brave throttle", async () => {
  const callTimestamps = [];

  const fakeFetch = async (_url, _opts) => {
    callTimestamps.push(Date.now());
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ organic: [] }),
    };
  };

  const provider = createWebSearchProvider({
    provider: "serper",
    serperKey: "test-serper-key",
    fetchImpl: fakeFetch,
  });

  const t0 = Date.now();
  await Promise.all([provider("a"), provider("b"), provider("c")]);
  const elapsed = Date.now() - t0;

  // Serper calls are not serialised — all 3 should complete well under 200ms.
  assert.ok(elapsed < 500, `Serper should not be throttled; elapsed=${elapsed}ms`);
  assert.equal(callTimestamps.length, 3);
});
