// services/webSearchProvider.js
//
// Thin abstraction over web-search APIs used by the contact-enrichment
// pipeline. Supports Brave Search (preferred) and Serper (fallback).
//
// When neither provider is configured the factory returns a stub that always
// resolves to { ok: false, error: "WEB_SEARCH_NOT_CONFIGURED" } so the
// pipeline can degrade gracefully without blowing up on unconfigured servers.
//
// Usage:
//   const search = createWebSearchProvider();
//   const res = await search("Dupont Immobilier Montréal téléphone");
//   if (res.ok) res.results.forEach(r => console.log(r.title, r.snippet, r.url));
//
// Each result: { title: string, snippet: string, url: string }

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SERPER_ENDPOINT = "https://google.serper.dev/search";

// Normalise Brave results to { title, snippet, url }
function parseBraveResults(json) {
  const items = json?.web?.results || [];
  return items.map((r) => ({
    title: String(r.title || ""),
    snippet: String(r.description || ""),
    url: String(r.url || ""),
  }));
}

// Normalise Serper results to { title, snippet, url }
function parseSerperResults(json) {
  const items = json?.organic || [];
  return items.map((r) => ({
    title: String(r.title || ""),
    snippet: String(r.snippet || ""),
    url: String(r.link || ""),
  }));
}

// Build a Brave search function using the given API key and optional fetch override.
function createBraveProvider(apiKey, fetchImpl = fetch) {
  return async function braveSearch(query) {
    const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=5&text_decorations=0`;
    let resp;
    try {
      resp = await fetchImpl(url, {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
        },
      });
    } catch (err) {
      return { ok: false, error: `BRAVE_FETCH_ERROR: ${err.message}` };
    }
    if (!resp.ok) {
      return { ok: false, error: `BRAVE_HTTP_${resp.status}` };
    }
    let json;
    try {
      json = await resp.json();
    } catch {
      return { ok: false, error: "BRAVE_JSON_PARSE_ERROR" };
    }
    return { ok: true, results: parseBraveResults(json) };
  };
}

// Build a Serper search function using the given API key and optional fetch override.
function createSerperProvider(apiKey, fetchImpl = fetch) {
  return async function serperSearch(query) {
    let resp;
    try {
      resp = await fetchImpl(SERPER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });
    } catch (err) {
      return { ok: false, error: `SERPER_FETCH_ERROR: ${err.message}` };
    }
    if (!resp.ok) {
      return { ok: false, error: `SERPER_HTTP_${resp.status}` };
    }
    let json;
    try {
      json = await resp.json();
    } catch {
      return { ok: false, error: "SERPER_JSON_PARSE_ERROR" };
    }
    return { ok: true, results: parseSerperResults(json) };
  };
}

// Stub returned when no provider is configured.
function createNotConfiguredProvider() {
  return async function notConfiguredSearch(_query) {
    return { ok: false, error: "WEB_SEARCH_NOT_CONFIGURED" };
  };
}

/**
 * Factory: reads env vars and returns the best available search function.
 *
 * @param {object} [opts]
 * @param {string}   [opts.provider]   Override WEB_SEARCH_PROVIDER env var.
 * @param {string}   [opts.braveKey]   Override BRAVE_SEARCH_API_KEY env var.
 * @param {string}   [opts.serperKey]  Override SERPER_API_KEY env var.
 * @param {Function} [opts.fetchImpl]  Injectable fetch (for tests).
 * @returns {Function} async (query: string) => { ok, results?, error? }
 */
export function createWebSearchProvider(opts = {}) {
  const provider = (opts.provider ?? process.env.WEB_SEARCH_PROVIDER ?? "").toLowerCase();
  const braveKey = opts.braveKey ?? process.env.BRAVE_SEARCH_API_KEY ?? "";
  const serperKey = opts.serperKey ?? process.env.SERPER_API_KEY ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Explicit provider preference
  if (provider === "brave" && braveKey) return createBraveProvider(braveKey, fetchImpl);
  if (provider === "serper" && serperKey) return createSerperProvider(serperKey, fetchImpl);

  // Auto-detect: Brave preferred, Serper fallback
  if (braveKey) return createBraveProvider(braveKey, fetchImpl);
  if (serperKey) return createSerperProvider(serperKey, fetchImpl);

  return createNotConfiguredProvider();
}

// Convenience export: normalised result type jsdoc alias.
// Each result: { title: string, snippet: string, url: string }
export { parseBraveResults, parseSerperResults };
