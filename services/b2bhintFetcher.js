// services/b2bhintFetcher.js
//
// Pure helpers for fetching and parsing B2BHint company profile pages to
// extract director / officer names. No real HTTP is made here — the fetchPageFn
// dependency is injected so tests can run without any network access.
//
// Design:
//   - isB2BHintProfileUrl(url)               → true for b2bhint.com/…company… URLs
//   - extractDirectorsFromHtml(html)          → string[] of deduplicated name-only strings
//   - fetchAndExtractDirectors(url, fetchFn)  → { directors, fetched, error? }

// ─── URL detection ───────────────────────────────────────────────────────────

const B2BHINT_PROFILE_RE =
  /\bb2bhint\.com\/(?:[a-z]{2}\/)?(?:company|entreprise|fr\/company|en\/company)[/\-]/i;

/**
 * Returns true for B2BHint company-profile page URLs.
 * Returns false for the B2BHint home page, search pages, or other domains.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isB2BHintProfileUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!url.includes("b2bhint.com")) return false;
  return B2BHINT_PROFILE_RE.test(url);
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

// Role/title keywords to strip from extracted names.
// These appear as suffixes or parenthetical notes in B2BHint HTML.
const ROLE_SUFFIX_RE =
  /\s*[(\[,]?\s*(?:pr[eé]sident(?:e)?|vice[- ]pr[eé]sident(?:e)?|secr[eé]taire|administrateur(?:rice)?|director|officer|treasurer|tr[eé]sorier(?:ère)?|associ[eé](?:e)?|actionnaire|fondateur(?:rice)?|g[eé]rant(?:e)?|directeur(?:rice)?|partner|associat(?:ed)?)\s*[\])]?/gi;

// Structured field label patterns — signals a directors/officers section.
const DIRECTOR_LABEL_PATTERN =
  /(?:dirigeants?|administrateurs?|directors?|officers?|pr[eé]sidents?|secr[eé]taires?|associ[eé]s?|vice[- ]pr[eé]sidents?|tr[eé]soriers?|treasurer)/i;

/**
 * Extract director / officer names from B2BHint HTML.
 * Returns a deduplicated array of name-only strings (no titles, no roles).
 *
 * Parsing strategy (in priority order):
 *   1. <dt>LABEL</dt><dd>CONTENT</dd> pairs
 *   2. <th>LABEL</th><td>CONTENT</td> pairs
 *   3. Plain-text label scanning after stripping tags
 *
 * @param {string} html
 * @returns {string[]}
 */
export function extractDirectorsFromHtml(html) {
  if (!html || typeof html !== "string" || !html.trim()) return [];

  try {
    // Strip scripts and styles for cleaner text.
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");

    const names = [];

    // Strategy 1: <dt>LABEL</dt><dd>CONTENT</dd>
    const dtddRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let m;
    while ((m = dtddRe.exec(clean)) !== null) {
      const label = m[1].replace(/<[^>]+>/g, "").trim();
      if (!DIRECTOR_LABEL_PATTERN.test(label)) continue;
      const content = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      extractNamesFromText(content, names);
    }

    // Strategy 2: <th>LABEL</th><td>CONTENT</td>
    const thtdRe = /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((m = thtdRe.exec(clean)) !== null) {
      const label = m[1].replace(/<[^>]+>/g, "").trim();
      if (!DIRECTOR_LABEL_PATTERN.test(label)) continue;
      const content = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      extractNamesFromText(content, names);
    }

    // Strategy 3: plain-text label scanning (fallback when structured failed)
    if (names.length === 0) {
      const plainText = clean
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();

      const labelRe = new RegExp(
        "(?:dirigeants?|administrateurs?|directors?|officers?|pr[eé]sidents?|secr[eé]taires?|associ[eé]s?)\\s*[:\\-–]\\s*([^.\\n]{3,200})",
        "gi",
      );
      while ((m = labelRe.exec(plainText)) !== null) {
        extractNamesFromText(m[1], names);
      }
    }

    // Deduplicate, preserving insertion order.
    const seen = new Set();
    return names.filter((n) => {
      const low = n.toLowerCase();
      if (seen.has(low)) return false;
      seen.add(low);
      return true;
    });
  } catch (_err) {
    return [];
  }
}

/**
 * Split a comma/semicolon/bullet-separated string into individual names,
 * strip role suffixes and parenthetical notes, and push valid names into out[].
 *
 * @param {string} text
 * @param {string[]} out  Mutated in-place.
 */
function extractNamesFromText(text, out) {
  const parts = String(text || "")
    .split(/[,;•·|\n]+/)
    .map((p) => p.trim());

  for (let raw of parts) {
    // Strip parenthetical roles: "(Président)", "(Secrétaire et trésorier)", etc.
    raw = raw.replace(/\s*\([^)]*\)/g, "").trim();

    // Strip role suffixes that may appear without parentheses.
    raw = raw.replace(ROLE_SUFFIX_RE, "").trim();

    // Remove stray punctuation at start/end.
    raw = raw.replace(/^[,;:\-–•·\s]+|[,;:\-–•·\s]+$/g, "").trim();

    // Reject entries that are too short, too long, or look like non-names.
    if (
      !raw ||
      raw.length < 3 ||
      raw.length > 60 ||
      !/[a-zA-ZÀ-ÿ]/.test(raw) ||
      /^\d/.test(raw)
    ) {
      continue;
    }

    out.push(raw);
  }
}

// ─── Async wrapper ────────────────────────────────────────────────────────────

/**
 * Fetch a B2BHint profile page and extract directors from the HTML.
 *
 * @param {string} url
 * @param {function} fetchPageFn  async (url: string) => string|null
 * @returns {Promise<{ directors: string[], fetched: boolean, error?: string }>}
 */
export async function fetchAndExtractDirectors(url, fetchPageFn) {
  if (typeof fetchPageFn !== "function") {
    return { directors: [], fetched: false };
  }

  let html;
  try {
    html = await fetchPageFn(url);
  } catch (err) {
    return {
      directors: [],
      fetched: false,
      error: String(err?.message || err),
    };
  }

  if (!html) {
    return { directors: [], fetched: false };
  }

  const directors = extractDirectorsFromHtml(html);
  return { directors, fetched: true };
}
