// proforma-web/src/lib/enrichmentOrchestrator.test.js
//
// Unit tests for runEnrichmentOrchestrator. Pure logic — no React, no network.

import { runEnrichmentOrchestrator } from "./enrichmentOrchestrator.js";

// Helper: build a package entry
function pkg(key, name) {
  return { packageKey: key, package: { lead_owner_name: name || key } };
}

// Helper: callSingle that resolves immediately with ok=true
function okCallSingle(p) {
  return Promise.resolve({ ok: true, result: { lead_owner_name: p.lead_owner_name, status: "ready_to_call" } });
}

// Helper: create a deferred promise
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("runEnrichmentOrchestrator", () => {
  // 1. Empty package list
  test("empty package list resolves immediately with completed=0", async () => {
    const res = await runEnrichmentOrchestrator({
      packages: [],
      callSingle: okCallSingle,
    });
    expect(res.completed).toBe(0);
    expect(res.results.size).toBe(0);
    expect(res.errors.size).toBe(0);
    expect(res.cancelled).toBe(false);
  });

  // 2. Concurrency=1 — exactly 1 in-flight at any time
  test("concurrency=1 never has more than 1 in-flight call at a time", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const deferreds = [];

    const packages = [pkg("a"), pkg("b"), pkg("c")];

    const callSingle = jest.fn(() => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      const d = deferred();
      deferreds.push({ d, done: () => { current--; d.resolve({ ok: true, result: { status: "done" } }); } });
      return d.promise;
    });

    const runPromise = runEnrichmentOrchestrator({ packages, concurrency: 1, callSingle });

    // Tick through each call one at a time
    for (let i = 0; i < packages.length; i++) {
      // Wait for the next deferred to be registered
      while (deferreds.length === 0) {
        await Promise.resolve();
      }
      deferreds.shift().done();
      await Promise.resolve();
      await Promise.resolve();
    }

    const result = await runPromise;

    expect(maxConcurrent).toBe(1);
    expect(result.completed).toBe(3);
  });

  // 3. Concurrency=3 with 10 packages — all 10 complete, max 3 concurrent
  test("concurrency=3 with 10 packages: all complete, max 3 concurrent", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const deferreds = [];

    const packages = Array.from({ length: 10 }, (_, i) => pkg(`p${i}`));

    const callSingle = jest.fn(() => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      const d = deferred();
      deferreds.push({ d, done: () => { current--; d.resolve({ ok: true, result: { status: "done" } }); } });
      return d.promise;
    });

    const runPromise = runEnrichmentOrchestrator({ packages, concurrency: 3, callSingle });

    // Drain all 10 calls
    for (let i = 0; i < packages.length; i++) {
      while (deferreds.length === 0) {
        await Promise.resolve();
      }
      deferreds.shift().done();
      await Promise.resolve();
      await Promise.resolve();
    }

    const result = await runPromise;

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(result.completed).toBe(10);
    expect(result.results.size).toBe(10);
    expect(result.cancelled).toBe(false);
  });

  // 4. Mid-run abort — returns cancelled=true, unstarted packages never fire
  test("abort signal stops new dispatches and resolves with cancelled=true", async () => {
    const controller = new AbortController();
    const startedKeys = [];
    const deferreds = [];

    // 5 packages with concurrency=1 — only 1 starts before abort
    const packages = Array.from({ length: 5 }, (_, i) => pkg(`p${i}`));

    const callSingle = jest.fn((p) => {
      startedKeys.push(p.lead_owner_name);
      const d = deferred();
      deferreds.push(d);
      return d.promise;
    });

    const runPromise = runEnrichmentOrchestrator({
      packages,
      concurrency: 1,
      callSingle,
      signal: controller.signal,
    });

    // Wait for first call to start
    while (deferreds.length === 0) {
      await Promise.resolve();
    }

    // Abort
    controller.abort();

    // Resolve the in-flight call with a cancelled response
    deferreds[0].resolve({ ok: false, cancelled: true, error: "Cancelled" });

    const result = await runPromise;

    expect(result.cancelled).toBe(true);
    expect(startedKeys.length).toBeLessThan(5);
  });

  // 5. callSingle errors are captured; queue continues
  test("callSingle errors are captured per-package and queue continues", async () => {
    const packages = [pkg("ok1"), pkg("err1"), pkg("ok2"), pkg("err2"), pkg("ok3")];

    const callSingle = jest.fn((p) => {
      if (p.lead_owner_name.startsWith("err")) {
        return Promise.reject(new Error(`Failed: ${p.lead_owner_name}`));
      }
      return Promise.resolve({ ok: true, result: { status: "ready_to_call" } });
    });

    const result = await runEnrichmentOrchestrator({
      packages,
      concurrency: 1,
      callSingle,
    });

    expect(result.completed).toBe(3);
    expect(result.results.size).toBe(3);
    expect(result.errors.size).toBe(2);
    expect(result.errors.has("err1")).toBe(true);
    expect(result.errors.has("err2")).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  // 6. onProgress called with correct phases
  test("onProgress called with start+done for success, start+error for failure", async () => {
    const packages = [pkg("ok"), pkg("fail")];
    const progressLog = [];

    const callSingle = jest.fn((p) => {
      if (p.lead_owner_name === "fail") {
        return Promise.resolve({ ok: false, error: "search failed" });
      }
      return Promise.resolve({ ok: true, result: { status: "ready_to_call" } });
    });

    const onProgress = jest.fn((evt) => {
      progressLog.push({ packageKey: evt.packageKey, phase: evt.phase });
    });

    await runEnrichmentOrchestrator({
      packages,
      concurrency: 2,
      callSingle,
      onProgress,
    });

    const okEvents = progressLog.filter((e) => e.packageKey === "ok");
    const failEvents = progressLog.filter((e) => e.packageKey === "fail");

    expect(okEvents).toHaveLength(2);
    expect(okEvents[0].phase).toBe("start");
    expect(okEvents[1].phase).toBe("done");

    expect(failEvents).toHaveLength(2);
    expect(failEvents[0].phase).toBe("start");
    expect(failEvents[1].phase).toBe("error");
  });

  // 7. signal.aborted=true mid-run drops queue and returns cancelled=true
  test("signal.aborted=true mid-run drops queue and returns cancelled=true", async () => {
    const controller = new AbortController();
    const startedKeys = [];
    const deferreds = [];

    const packages = Array.from({ length: 5 }, (_, i) => ({
      packageKey: `p${i}`,
      package: { lead_owner_name: `p${i}` },
    }));

    const callSingle = jest.fn((p) => {
      startedKeys.push(p.lead_owner_name);
      const d = deferred();
      deferreds.push(d);
      return d.promise;
    });

    const runPromise = runEnrichmentOrchestrator({
      packages,
      concurrency: 1,
      callSingle,
      signal: controller.signal,
    });

    // Wait for first call to start
    while (deferreds.length === 0) {
      await Promise.resolve();
    }

    // Abort the session-level signal
    controller.abort();

    // Resolve the in-flight call with cancelled response
    deferreds[0].resolve({ ok: false, cancelled: true, error: "Cancelled" });

    const result = await runPromise;

    expect(result.cancelled).toBe(true);
    // Only 1 started — the rest were dropped from the queue
    expect(startedKeys.length).toBe(1);
    expect(startedKeys.length).toBeLessThan(5);
  });

  // 8. per-call cancel (res.cancelled=true) records error but queue continues
  test("per-call cancel (res.cancelled=true) records error but queue continues", async () => {
    const packages = [
      { packageKey: "a", package: { lead_owner_name: "a" } },
      { packageKey: "b", package: { lead_owner_name: "b" } },
      { packageKey: "c", package: { lead_owner_name: "c" } },
    ];
    const progressLog = [];

    // "b" returns a per-call cancelled response (e.g., timeout); "a" and "c" succeed
    const callSingle = jest.fn((p) => {
      if (p.lead_owner_name === "b") {
        return Promise.resolve({ ok: false, cancelled: true, error: "Request timed out (90s)" });
      }
      return Promise.resolve({
        ok: true,
        result: { status: "ready_to_call", lead_owner_name: p.lead_owner_name },
      });
    });

    const onProgress = jest.fn((evt) => {
      progressLog.push({ packageKey: evt.packageKey, phase: evt.phase });
    });

    const result = await runEnrichmentOrchestrator({
      packages,
      concurrency: 1,
      callSingle,
      onProgress,
    });

    // NOT cancelled at session level
    expect(result.cancelled).toBe(false);
    // a and c succeeded
    expect(result.completed).toBe(2);
    expect(result.results.has("a")).toBe(true);
    expect(result.results.has("c")).toBe(true);
    // b got an error recorded
    expect(result.errors.has("b")).toBe(true);
    expect(result.errors.get("b")).toBe("Request timed out (90s)");

    // All three packages had progress events
    const aEvents = progressLog.filter((e) => e.packageKey === "a");
    const bEvents = progressLog.filter((e) => e.packageKey === "b");
    const cEvents = progressLog.filter((e) => e.packageKey === "c");
    expect(aEvents.map((e) => e.phase)).toEqual(["start", "done"]);
    expect(bEvents.map((e) => e.phase)).toEqual(["start", "error"]);
    expect(cEvents.map((e) => e.phase)).toEqual(["start", "done"]);
  });
});
