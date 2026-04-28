// proforma-web/src/lib/contactEnrichmentPreview.js
//
// Dev-only helpers for the contact-enrichment preview button inside the
// Search-package preview panel.
//
// Gated by a separate localStorage flag (`pf_websearch_debug`) so it stays
// invisible unless explicitly enabled:
//   localStorage.setItem("pf_websearch_debug", "1")  // enable
//   localStorage.setItem("pf_websearch_debug", "0")  // disable
//
// Pure logic — no React imports. Testable in isolation.

const WEB_DEBUG_FLAG = "pf_websearch_debug";

// Returns true when the web-search dev flag is on.
export function isContactEnrichmentDebugEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(WEB_DEBUG_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * POST the given search packages to the backend enrichment preview endpoint.
 *
 * Pass `options.signal` (an AbortSignal) to make the request cancellable —
 * when aborted the returned object has `cancelled: true` so the caller can
 * distinguish a user cancel from a network/server error.
 *
 * @param {object[]} packages  Raw search-package objects (from buildSearchPackagePreviewData).
 * @param {object}  [options]
 * @param {number}  [options.limit=5]  How many packages to process (max 100).
 * @param {AbortSignal} [options.signal]  Abort signal to cancel the in-flight request.
 * @returns {Promise<{ ok: boolean, results?: object[], error?: string, cancelled?: boolean }>}
 */
export async function runContactEnrichmentPreview(packages, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 5;
  const signal = options.signal;
  try {
    const resp = await fetch("/api/contact-enrichment/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packages, limit }),
      signal,
    });
    const json = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: json?.error || `HTTP ${resp.status}` };
    }
    return json;
  } catch (err) {
    // AbortController-driven cancel surfaces as DOMException name "AbortError"
    // (browser fetch) or err.name === "AbortError" in jsdom. Treat as cancel.
    if (err && (err.name === "AbortError" || signal?.aborted)) {
      return { ok: false, cancelled: true, error: "Cancelled" };
    }
    return { ok: false, error: String(err?.message || err) };
  }
}
