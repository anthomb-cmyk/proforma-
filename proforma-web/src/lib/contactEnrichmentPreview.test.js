import {
  isContactEnrichmentDebugEnabled,
  runContactEnrichmentPreview,
} from "./contactEnrichmentPreview.js";

describe("isContactEnrichmentDebugEnabled", () => {
  beforeEach(() => {
    try { localStorage.removeItem("pf_websearch_debug"); } catch {}
  });

  test("returns false when flag is unset", () => {
    expect(isContactEnrichmentDebugEnabled()).toBe(false);
  });

  test("returns true when flag is '1'", () => {
    localStorage.setItem("pf_websearch_debug", "1");
    expect(isContactEnrichmentDebugEnabled()).toBe(true);
  });

  test("returns false for any other value", () => {
    localStorage.setItem("pf_websearch_debug", "0");
    expect(isContactEnrichmentDebugEnabled()).toBe(false);
    localStorage.setItem("pf_websearch_debug", "true");
    expect(isContactEnrichmentDebugEnabled()).toBe(false);
  });
});

describe("runContactEnrichmentPreview", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("resolves ok:true with results on a successful response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, results: [{ status: "ready_to_call" }] }),
    });
    const res = await runContactEnrichmentPreview([{ x: 1 }], { limit: 1 });
    expect(res.ok).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ packages: [{ x: 1 }], limit: 1 });
  });

  test("resolves ok:false with error on HTTP failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    const res = await runContactEnrichmentPreview([], { limit: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
    expect(res.cancelled).toBeFalsy();
  });

  test("resolves ok:false, cancelled:true when AbortSignal aborts the request", async () => {
    // Simulate fetch that rejects with an AbortError when its signal aborts.
    global.fetch = jest.fn((_url, opts) => new Promise((_resolve, reject) => {
      const sig = opts?.signal;
      if (!sig) return;
      const onAbort = () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      };
      if (sig.aborted) onAbort();
      else sig.addEventListener("abort", onAbort, { once: true });
    }));
    const controller = new AbortController();
    const p = runContactEnrichmentPreview([], { limit: 1, signal: controller.signal });
    controller.abort();
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.cancelled).toBe(true);
    expect(res.error).toBe("Cancelled");
  });

  test("resolves ok:false with error string on network failure (no abort)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    const res = await runContactEnrichmentPreview([], { limit: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network down");
    expect(res.cancelled).toBeFalsy();
  });

  test("forwards limit option, defaults to 5 when absent", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, results: [] }),
    });
    await runContactEnrichmentPreview([{}, {}, {}]);
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).limit).toBe(5);
  });
});
