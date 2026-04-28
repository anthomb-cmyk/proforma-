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
 * @param {object[]} packages  Raw search-package objects (from buildSearchPackagePreviewData).
 * @param {object}  [options]
 * @param {number}  [options.limit=5]  How many packages to process (max 100).
 * @returns {Promise<{ ok: boolean, results?: object[], error?: string }>}
 */
export async function runContactEnrichmentPreview(packages, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 5;
  try {
    const resp = await fetch("/api/contact-enrichment/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packages, limit }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: json?.error || `HTTP ${resp.status}` };
    }
    return json;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
