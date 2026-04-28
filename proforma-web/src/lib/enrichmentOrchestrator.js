// proforma-web/src/lib/enrichmentOrchestrator.js
//
// Pure client-side orchestrator that manages a queue + concurrency pool of
// per-package enrichment calls via the /api/contact-enrichment/single endpoint.
// No React imports — fully testable in isolation.

/**
 * POST a single package to /api/contact-enrichment/single.
 * Production callSingle implementation — injected into runEnrichmentOrchestrator
 * so tests can substitute a mock without network access.
 *
 * @param {{ lead_owner_name?: string, [k: string]: any }} pkg
 * @param {AbortSignal} [signal]
 * @param {{ placesFallbackEnabled?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, cancelled?: boolean }>}
 */
export async function postEnrichmentSingle(pkg, signal, opts = {}) {
  // Compose the caller-provided signal with a 90-second internal timeout so a
  // hung server call cannot block a worker slot indefinitely.
  let composed;
  const timeout = AbortSignal.timeout(90_000);
  if (typeof AbortSignal.any === "function") {
    composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  } else {
    // Polyfill for environments that lack AbortSignal.any (Safari < 17.4).
    const controller = new AbortController();
    const done = () => controller.abort();
    timeout.addEventListener("abort", done, { once: true });
    if (signal) signal.addEventListener("abort", done, { once: true });
    composed = controller.signal;
  }

  try {
    const resp = await fetch("/api/contact-enrichment/single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: pkg,
        placesFallbackEnabled: opts.placesFallbackEnabled === true,
      }),
      signal: composed,
    });
    const json = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: json?.error || `HTTP ${resp.status}` };
    }
    return json;
  } catch (err) {
    if (err && err.name === "AbortError") {
      // Distinguish user-cancel from timeout abort.
      if (signal?.aborted) {
        return { ok: false, cancelled: true, error: "Cancelled" };
      }
      // Timeout fired (or composed abort without user signal).
      return { ok: false, error: "Request timed out (90s)" };
    }
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Run per-package enrichment with a bounded concurrency pool.
 *
 * @param {object} opts
 * @param {Array<{packageKey: string, package: object}>} opts.packages
 *   Items to enrich. Each must have a unique `packageKey`.
 * @param {number} [opts.concurrency=3]   Max simultaneous in-flight calls (1–10).
 * @param {Function} opts.callSingle      async (pkg, signal) => { ok, result?, error?, cancelled? }
 * @param {Function} [opts.onProgress]    ({ packageKey, phase, result?, error? }) => void
 *   `phase` is 'start', 'done', or 'error'.
 * @param {AbortSignal} [opts.signal]     Abort signal — fires to cancel the whole run.
 * @returns {Promise<{ completed: number, results: Map<string,object>, errors: Map<string,Error|string>, cancelled: boolean }>}
 */
export async function runEnrichmentOrchestrator({
  packages = [],
  concurrency = 3,
  callSingle,
  onProgress,
  signal,
}) {
  const clampedConcurrency = Math.max(1, Math.min(10, Math.round(concurrency)));

  const results = new Map();
  const errors = new Map();

  if (!packages.length) {
    return { completed: 0, results, errors, cancelled: false };
  }

  let cancelled = false;
  let completed = 0;

  // Queue of items still waiting to start
  const queue = [...packages];

  // Notify a phase change if caller supplied onProgress
  function notify(packageKey, phase, extra = {}) {
    if (typeof onProgress === "function") {
      try {
        onProgress({ packageKey, phase, ...extra });
      } catch {
        // Swallow progress callback errors — they must not abort the queue
      }
    }
  }

  // Worker: pulls items from the front of queue and processes them serially.
  // Multiple workers run concurrently (one per slot).
  async function worker() {
    while (queue.length > 0) {
      // Check for cancellation before starting a new item
      if (signal?.aborted) {
        cancelled = true;
        queue.length = 0; // Drop remaining items
        return;
      }

      const item = queue.shift();
      if (!item) break; // Another worker grabbed it

      const { packageKey, package: pkg } = item;
      notify(packageKey, "start");

      try {
        const res = await callSingle(pkg, signal);

        if (signal?.aborted) {
          cancelled = true;
          errors.set(packageKey, "Cancelled");
          notify(packageKey, "error", { error: "Cancelled" });
          queue.length = 0;
          return;
        }
        if (res?.cancelled) {
          // Per-call abort (e.g., timeout) — record error and continue the queue.
          errors.set(packageKey, res.error || "Cancelled");
          notify(packageKey, "error", { error: res.error || "Cancelled" });
          continue;
        }

        if (res?.ok) {
          results.set(packageKey, res.result);
          completed++;
          notify(packageKey, "done", { result: res.result });
        } else {
          const errVal = res?.error || "Unknown error";
          errors.set(packageKey, errVal);
          notify(packageKey, "error", { error: errVal });
          // Error does NOT stop the queue — other packages continue
        }
      } catch (err) {
        const errVal = err?.message || String(err);
        errors.set(packageKey, errVal);
        notify(packageKey, "error", { error: errVal });
        // Continue the queue
      }
    }
  }

  // Launch `clampedConcurrency` workers in parallel
  const slots = Array.from({ length: Math.min(clampedConcurrency, packages.length) }, worker);
  await Promise.all(slots);

  return { completed, results, errors, cancelled };
}
