// services/contactEnrichmentPipeline.js
//
// Dev-only contact enrichment pipeline for search packages.
// Called by POST /api/contact-enrichment/preview.
//
// Design notes:
//   - Pure function: network is injected (searchFn, fetchPageFn) so tests
//     can run without external calls.
//   - Hard limits guard against runaway API spend.
//   - Skips packages that already have an owner-direct phone — no need to
//     look them up.
//   - Does NOT write to the CRM, does NOT call /api/phone-lookup, does NOT
//     use Google Places.

import { isValidNanpPhone, normalizePhoneKey } from "./phoneEnrichment.js";

/* ─── Hard limits ──────────────────────────────────────────────────────────── */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_DIRECT_QUERIES = 3;
const MAX_MAILING_QUERIES = 2;
const MAX_RELATED_COMPANIES = 2;
const MAX_PAGES_PER_SITE = 2;

/* ─── Phone / email / URL extraction from free text ───────────────────────── */

// Broad NANP pattern — isValidNanpPhone filters junk afterwards.
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)(?:\d{3}[-.\s]?\d{4})/g;

// RFC-5321-ish; good enough for snippets.
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// URLs starting with http(s):// or www.
const URL_RE = /https?:\/\/[^\s"'<>)]+|www\.[^\s"'<>)]+/gi;

function extractPhones(text) {
  if (!text) return [];
  const raw = String(text).match(PHONE_RE) || [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const digits = normalizePhoneKey(r);
    if (digits && isValidNanpPhone(digits) && !seen.has(digits)) {
      seen.add(digits);
      out.push({ raw: r.trim(), digits });
    }
  }
  return out;
}

function extractEmails(text) {
  if (!text) return [];
  const raw = String(text).match(EMAIL_RE) || [];
  const seen = new Set();
  return raw.filter((e) => {
    const low = e.toLowerCase();
    if (seen.has(low)) return false;
    seen.add(low);
    return true;
  });
}

function extractUrls(text) {
  if (!text) return [];
  const raw = String(text).match(URL_RE) || [];
  const seen = new Set();
  return raw
    .map((u) => u.replace(/[.,;:!?)]+$/, ""))   // strip trailing punctuation
    .filter((u) => {
      const low = u.toLowerCase();
      if (seen.has(low)) return false;
      seen.add(low);
      return true;
    });
}

/* ─── Owner-direct phone detection ────────────────────────────────────────── */

// Returns true when the package already has at least one phone whose
// relationship_to_lead_owner is "owner" — we don't need to search for it.
function pkgHasOwnerDirectPhone(pkg) {
  for (const c of pkg.candidatePhones || []) {
    if (normalizePhoneKey(c?.phone) && c?.relationship_to_lead_owner === "owner") return true;
  }
  return false;
}

/* ─── Candidate scoring ────────────────────────────────────────────────────── */

// Very simple scoring: multiply source weight × recurrence weight.
// Source weights: direct-entity search snippet > page body > mailing-address
// search snippet > related-company search.
const SOURCE_WEIGHTS = {
  direct_entity: 3,
  page: 2,
  mailing: 1,
  related: 1,
};

function scorePhoneCandidate(c) {
  const sw = SOURCE_WEIGHTS[c.source] || 1;
  return sw * (c.occurrences || 1);
}

/* ─── HTML page scraping helpers ───────────────────────────────────────────── */

// Derive candidate sub-pages to fetch for a given homepage URL.
// Returns at most MAX_PAGES_PER_SITE URLs including the homepage itself.
function buildPageUrls(homepageUrl, max) {
  const base = homepageUrl.replace(/\/+$/, "");
  const pages = [homepageUrl];
  for (const suffix of ["/contact", "/nous-joindre", "/contact-us"]) {
    if (pages.length >= max) break;
    pages.push(`${base}${suffix}`);
  }
  return pages;
}

/* ─── Main pipeline ─────────────────────────────────────────────────────────── */

/**
 * Run the contact-enrichment pipeline over a list of search packages.
 *
 * @param {object} params
 * @param {object[]} params.packages  Array of search-package objects (output of buildSearchPackages).
 * @param {number}  [params.limit]    How many packages to process (default 5, max 10).
 * @param {Function} params.searchFn  async (query) => { ok, results: [{title,snippet,url}] }
 * @param {Function} [params.fetchPageFn]  async (url) => html string | null
 * @param {object}  [params.options]  Fine-grained overrides for hard limits.
 * @returns {Promise<object[]>}  Array of enrichment result objects.
 */
export async function runContactEnrichmentPreview({
  packages,
  limit: rawLimit,
  searchFn,
  fetchPageFn,
  options = {},
}) {
  if (!Array.isArray(packages) || !packages.length) return [];
  if (typeof searchFn !== "function") throw new Error("searchFn is required");

  const safeFetchPage = typeof fetchPageFn === "function" ? fetchPageFn : async () => null;

  const limit = Math.min(
    Math.max(1, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const maxDirect = Number.isFinite(options.maxDirectQueries)
    ? Math.min(options.maxDirectQueries, MAX_DIRECT_QUERIES)
    : MAX_DIRECT_QUERIES;
  const maxMailing = Number.isFinite(options.maxMailingQueries)
    ? Math.min(options.maxMailingQueries, MAX_MAILING_QUERIES)
    : MAX_MAILING_QUERIES;
  const maxRelated = Number.isFinite(options.maxRelatedCompanies)
    ? Math.min(options.maxRelatedCompanies, MAX_RELATED_COMPANIES)
    : MAX_RELATED_COMPANIES;
  const maxPages = Number.isFinite(options.maxPagesPerSite)
    ? Math.min(options.maxPagesPerSite, MAX_PAGES_PER_SITE)
    : MAX_PAGES_PER_SITE;

  const batch = packages.slice(0, limit);
  const results = [];

  for (const pkg of batch) {
    const result = await processSinglePackage(pkg, {
      searchFn,
      fetchPageFn: safeFetchPage,
      maxDirect,
      maxMailing,
      maxRelated,
      maxPages,
    });
    results.push(result);
  }

  return results;
}

async function processSinglePackage(pkg, opts) {
  const base = {
    lead_owner_name: pkg.lead_owner_name || "",
    legal_entity_category: pkg.legal_entity_category || "unknown",
    mailing_address: pkg.mailing_address || "",
    mailing_city: pkg.mailing_city || "",
    lead_value_priority: pkg.lead_value_priority || "low",
    search_need_priority: pkg.search_need_priority || "low",
    bestPhone: null,
    bestPhoneBelongsTo: null,
    phoneRelationship: null,
    bestEmail: null,
    bestWebsite: null,
    phoneCandidates: [],
    emailCandidates: [],
    websiteCandidates: [],
    relatedCompanies: [],
    evidence: [],
    confidence: "low",
    status: "no_contact_found",
  };

  // Step 0 — skip packages that already have an owner-direct phone.
  if (pkgHasOwnerDirectPhone(pkg)) {
    return { ...base, status: "skipped_existing_phone" };
  }

  const phoneCands = [];  // { digits, raw, belongsTo, source, url, occurrences }
  const emailCands = [];  // { email, source, url }
  const websiteCands = [];  // { url, source }
  const relatedCompanies = [];  // { name, url }
  const evidence = [];  // string notes for transparency

  const strategy = pkg.search_strategy || "direct_entity";
  const directQueries = (pkg.mailing_address_discovery_queries === undefined)
    ? buildDirectEntityQueriesLocal(pkg)
    : [];

  // Determine which queries to run based on strategy.
  const useDirectQueries = strategy !== "mailing_address_only" && strategy !== "skip_low_value";
  const useMailingQueries = strategy === "mailing_address_only"
    || strategy === "direct_entity_then_mailing_address_related_companies";

  // Step 1 — direct entity search (name-based).
  if (useDirectQueries) {
    const queries = buildDirectEntityQueriesLocal(pkg).slice(0, opts.maxDirect);
    for (const q of queries) {
      const res = await opts.searchFn(q);
      if (!res.ok) {
        evidence.push(`direct_search_failed: ${res.error}`);
        continue;
      }
      evidence.push(`direct_query: "${q}" → ${res.results.length} results`);
      for (const r of res.results) {
        const combined = `${r.title} ${r.snippet}`;
        for (const p of extractPhones(combined)) {
          recordPhone(phoneCands, p, "direct_entity", r.url, r.title);
        }
        for (const e of extractEmails(combined)) {
          recordEmail(emailCands, e, "direct_entity", r.url);
        }
        // Record the result URL itself as a website candidate in addition to
        // any URLs found inside the snippet text.
        if (r.url) recordWebsite(websiteCands, r.url, "direct_entity");
        for (const u of extractUrls(combined)) {
          recordWebsite(websiteCands, u, "direct_entity");
        }
      }
    }
  }

  // Step 2 — website page extraction.
  // Take the top unique website URL found so far and fetch its contact page.
  const topWebsite = websiteCands[0]?.url;
  if (topWebsite) {
    const pageUrls = buildPageUrls(topWebsite, opts.maxPages);
    for (const pageUrl of pageUrls) {
      const html = await opts.fetchPageFn(pageUrl);
      if (!html) continue;
      evidence.push(`page_fetched: ${pageUrl}`);
      const text = stripHtmlTags(html);
      for (const p of extractPhones(text)) {
        recordPhone(phoneCands, p, "page", pageUrl, pageUrl);
      }
      for (const e of extractEmails(text)) {
        recordEmail(emailCands, e, "page", pageUrl);
      }
    }
  }

  // Step 3 — mailing address discovery queries.
  if (useMailingQueries) {
    const mailingQueries = (pkg.mailing_address_discovery_queries || []).slice(0, opts.maxMailing);
    for (const q of mailingQueries) {
      const res = await opts.searchFn(q);
      if (!res.ok) {
        evidence.push(`mailing_search_failed: ${res.error}`);
        continue;
      }
      evidence.push(`mailing_query: "${q}" → ${res.results.length} results`);
      for (const r of res.results) {
        const combined = `${r.title} ${r.snippet}`;
        for (const p of extractPhones(combined)) {
          recordPhone(phoneCands, p, "mailing", r.url, r.title);
        }
        for (const e of extractEmails(combined)) {
          recordEmail(emailCands, e, "mailing", r.url);
        }
        // Track company names found at the mailing address as related companies.
        if (r.title && relatedCompanies.length < opts.maxRelated) {
          relatedCompanies.push({ name: r.title, url: r.url });
        }
      }
    }
  }

  // Step 4 — related company lookup: search for each related company individually.
  const relatedToSearch = relatedCompanies.slice(0, opts.maxRelated);
  for (const rel of relatedToSearch) {
    const q = rel.name;
    const res = await opts.searchFn(q);
    if (!res.ok) continue;
    evidence.push(`related_query: "${q}" → ${res.results.length} results`);
    for (const r of res.results.slice(0, 2)) {
      const combined = `${r.title} ${r.snippet}`;
      for (const p of extractPhones(combined)) {
        recordPhone(phoneCands, p, "related", r.url, rel.name);
      }
    }
  }

  // Step 5 — score and select best candidates.
  phoneCands.sort((a, b) => scorePhoneCandidate(b) - scorePhoneCandidate(a));

  const best = phoneCands[0] || null;

  let status = "no_contact_found";
  let confidence = "low";

  if (best) {
    const sc = scorePhoneCandidate(best);
    if (sc >= 6) confidence = "high";
    else if (sc >= 3) confidence = "medium";
    else confidence = "low";

    if (confidence === "high" || best.source === "direct_entity") {
      status = "ready_to_call";
    } else {
      status = "needs_review";
    }
  } else if (emailCands.length > 0) {
    status = "ready_to_email";
    confidence = "medium";
  }

  return {
    ...base,
    bestPhone: best ? best.raw : null,
    bestPhoneBelongsTo: best ? (best.belongsTo || null) : null,
    phoneRelationship: best ? best.source : null,
    bestEmail: emailCands[0]?.email || null,
    bestWebsite: websiteCands[0]?.url || null,
    phoneCandidates: phoneCands,
    emailCandidates: emailCands,
    websiteCandidates: websiteCands,
    relatedCompanies,
    evidence,
    confidence,
    status,
  };
}

/* ─── Candidate list helpers ─────────────────────────────────────────────── */

function recordPhone(list, { digits, raw }, source, url, belongsTo) {
  const existing = list.find((c) => c.digits === digits && c.source === source);
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
  } else {
    list.push({ digits, raw, source, url: url || "", belongsTo: belongsTo || "", occurrences: 1 });
  }
}

function recordEmail(list, email, source, url) {
  if (!list.some((c) => c.email === email)) {
    list.push({ email, source, url: url || "" });
  }
}

function recordWebsite(list, url, source) {
  if (!list.some((c) => c.url === url)) {
    list.push({ url, source });
  }
}

/* ─── Local query builder (mirrors searchPackage.js logic without importing) ── */

const JUNK_RE = /^(?:\d{6,8}|[\d\-]{10,30}|[a-z]{0,3}\d+[a-z]{0,3})$/i;
function looksLikeJunkLocal(name) {
  if (!name) return true;
  return JUNK_RE.test(String(name).trim());
}

function buildDirectEntityQueriesLocal(pkg) {
  const name = String(pkg.lead_owner_name || "").trim();
  if (!name) return [];
  if (pkg.legal_entity_category === "numbered_company") return [];
  if (pkg.legal_entity_category === "individual") return [];
  if (looksLikeJunkLocal(name)) return [];

  const city = String(pkg.mailing_city || "").trim();
  const prov = String(pkg.mailing_province || "QC").trim();
  const street = String(pkg.mailing_address || "").trim();

  const seen = new Set();
  const out = [];
  const push = (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(trimmed); }
  };

  const join = (...parts) => parts.filter(Boolean).join(", ");

  if (city) push(join(name, city, prov));
  if (street) push(join(name, street, city, prov));
  if (!city && prov) push(join(name, prov));
  push(name);
  return out;
}

/* ─── HTML tag stripper ────────────────────────────────────────────────────── */

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
