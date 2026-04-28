// services/contactEnrichmentPipeline.js
//
// Dev-only contact enrichment pipeline for search packages.
// Called by POST /api/contact-enrichment/preview.
//
// Design notes:
//   - Pure function: network is injected (searchFn, fetchPageFn) so tests
//     can run without external calls.
//   - Hard limits guard against runaway API spend.
//   - Skips packages that already have an owner-direct phone.
//   - Does NOT write to the CRM, does NOT call /api/phone-lookup, does NOT
//     use Google Places.
//
// Scoring rules (tightened in v2, status semantics revised in v3):
//   - Junk/directory/municipal results are rejected before any phone is recorded.
//   - Individual owners never receive mailing-address business phones.
//   - Direct/page sources require score ≥ 3 (medium confidence) to become bestPhone.
//   - Mailing/related sources are always promoted — same mailing address is a strong signal.
//   - ready_to_call: direct/page + nameMatch, OR any mailing/related source,
//     OR directory (pages_jaunes/411) + nameMatch.
//   - phoneRelationship semantic values: direct_entity_match, same_mailing_address_contact,
//     related_company_same_mailing_address, directory_match.

import { isValidNanpPhone, normalizePhoneKey, normalizeKey } from "./phoneEnrichment.js";
import { classifySource, isRejectedSource } from "./sourceQualityClassifier.js";
import {
  isCompanyProfileUrl,
  extractCompanyProfile,
  buildProfileExpansionQueries,
} from "./companyProfileExtractor.js";
import {
  validateCoOwnerMatch,
  isStrongCoOwnerMatch,
} from "./coOwnerValidator.js";

/* ─── Hard limits ──────────────────────────────────────────────────────────── */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;
const MAX_DIRECT_QUERIES = 3;
const MAX_MAILING_QUERIES = 2;
const MAX_RELATED_COMPANIES = 2;
const MAX_PAGES_PER_SITE = 2;
const MAX_ADDRESS_DISCOVERY_QUERIES = 7;
const MAX_PROFILE_EXPANSION_QUERIES = 5;

/* ─── Phone / email / URL extraction from free text ───────────────────────── */

const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)(?:\d{3}[-.\s]?\d{4})/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
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
    .map((u) => u.replace(/[.,;:!?)]+$/, ""))
    .filter((u) => {
      const low = u.toLowerCase();
      if (seen.has(low)) return false;
      seen.add(low);
      return true;
    });
}

/* ─── Junk result detection ────────────────────────────────────────────────── */

// Titles that signal a generic directory listing, shipping/mailbox store,
// or municipal/government page rather than the owner entity being searched.
const JUNK_TITLE_RE = /\b(?:ups\s+store|the\s+ups|purolator|fedex|dhl|canada\s+post|postes?\s+canada|courrier|courier|mailbox(?:es)?|mail\s+box|boite\s+postale|bo[iî]te\s+postale|packing\s+store|shipping\s+store|pages?\s+jaunes|yellowpages?|canada\s*411|411\s*canada|annuaire|yelp|tripadvisor|facebook|linkedin|instagram|mairie|ville\s+de|city\s+of|town\s+of|municipalit[eé]|h[oô]tel\s+de\s+ville|gouvernement|government)\b/i;

// Domains that are directories, social networks, or municipal portals.
const JUNK_DOMAIN_RE = /(?:facebook\.com|linkedin\.com|twitter\.com|instagram\.com|tiktok\.com|yelp\.com|yelp\.ca|yellowpages\.\w+|canada411\.ca|pagesjaunes\.ca|411\.ca|tripadvisor\.com|tripadvisor\.ca)/i;

const MUNICIPAL_DOMAIN_RE = /(?:gouv\.qc\.ca|\.gc\.ca|ville\.[a-z-]+\.(qc\.)?ca|mairie\.[a-z-]+\.ca)/i;

export function isJunkResult(title, url) {
  const t = String(title || "");
  const u = String(url || "");
  if (JUNK_TITLE_RE.test(t)) return true;
  if (JUNK_DOMAIN_RE.test(u)) return true;
  if (MUNICIPAL_DOMAIN_RE.test(u)) return true;
  return false;
}

/* ─── Name-overlap detection ───────────────────────────────────────────────── */

// Tokens too generic to drive a name match decision.
const NAME_STOP_WORDS = new Set([
  "inc", "ltee", "ltee", "llp", "llc", "corp", "ltd",
  "et", "and", "the", "a", "an",
  "le", "la", "les", "de", "du", "des", "en", "au", "aux",
]);

function significantTokens(name) {
  return normalizeKey(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !NAME_STOP_WORDS.has(t));
}

// Returns true when at least one significant token from the owner name appears
// in the result title, using prefix matching to handle slight morphological
// variants (e.g. "dupont" matches "duponts").
export function hasNameOverlap(ownerName, resultTitle) {
  if (!ownerName || !resultTitle) return false;
  const ot = significantTokens(ownerName);
  const rt = significantTokens(resultTitle);
  if (!ot.length || !rt.length) return false;
  return ot.some((a) => rt.some((b) => a === b || a.startsWith(b) || b.startsWith(a)));
}

/* ─── Real-estate keyword heuristic ───────────────────────────────────────── */

const REAL_ESTATE_RE = /\b(?:immobilier|immobili[eè]re|immo|gestion|holding|investissement|placement|properties|realty|real\s+estate|appartement|logement|r[eé]sidentiel|residential|locatif|locative|propri[eé]t[eé]s?|location)\b/i;

export function hasRealEstateKeyword(text) {
  return REAL_ESTATE_RE.test(String(text || ""));
}

/* ─── Owner-direct phone detection ────────────────────────────────────────── */

function pkgHasOwnerDirectPhone(pkg) {
  for (const c of pkg.candidatePhones || []) {
    if (normalizePhoneKey(c?.phone) && c?.relationship_to_lead_owner === "owner") return true;
  }
  return false;
}

/* ─── Candidate scoring ────────────────────────────────────────────────────── */

const SOURCE_WEIGHTS = {
  direct_entity: 3,
  page: 2,
  mailing: 1,
  related: 1,
};

// Name match doubles the score — it's the primary signal that the phone
// actually belongs to the entity we're searching for.
function scorePhoneCandidate(c) {
  const sw = SOURCE_WEIGHTS[c.source] || 1;
  const nameBonus = c.nameMatch ? 2 : 1;
  return sw * (c.occurrences || 1) * nameBonus;
}

function confidenceFromScore(score) {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

/* ─── HTML page scraping helpers ───────────────────────────────────────────── */

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
  const ownerName = pkg.lead_owner_name || "";
  const category = pkg.legal_entity_category || "unknown";
  const isIndividual = category === "individual";

  const base = {
    lead_owner_name: ownerName,
    legal_entity_category: category,
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

  if (pkgHasOwnerDirectPhone(pkg)) {
    return { ...base, status: "skipped_existing_phone" };
  }

  const phoneCands = [];
  const emailCands = [];
  const websiteCands = [];
  const relatedCompanies = [];
  const evidence = [];

  const strategy = pkg.search_strategy || "direct_entity";
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
        if (isJunkResult(r.title, r.url)) {
          evidence.push(`rejected: "${r.title}" (junk_business)`);
          continue;
        }
        const nameMatch = hasNameOverlap(ownerName, r.title);
        const combined = `${r.title} ${r.snippet}`;
        for (const p of extractPhones(combined)) {
          recordPhone(phoneCands, p, "direct_entity", r.url, r.title, nameMatch);
        }
        for (const e of extractEmails(combined)) {
          recordEmail(emailCands, e, "direct_entity", r.url);
        }
        if (r.url) recordWebsite(websiteCands, r.url, "direct_entity", nameMatch);
        for (const u of extractUrls(combined)) {
          recordWebsite(websiteCands, u, "direct_entity", nameMatch);
        }
      }
    }
  }

  // Step 2 — website page extraction from top non-junk result URL.
  const topWebsite = websiteCands.find((w) => !isJunkResult("", w.url));
  if (topWebsite) {
    const pageUrls = buildPageUrls(topWebsite.url, opts.maxPages);
    for (const pageUrl of pageUrls) {
      const html = await opts.fetchPageFn(pageUrl);
      if (!html) continue;
      evidence.push(`page_fetched: ${pageUrl}`);
      const text = stripHtmlTags(html);
      for (const p of extractPhones(text)) {
        recordPhone(phoneCands, p, "page", pageUrl, pageUrl, topWebsite.nameMatch);
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
        if (isJunkResult(r.title, r.url)) {
          evidence.push(`rejected: "${r.title}" (junk_business)`);
          continue;
        }
        const nameMatch = hasNameOverlap(ownerName, r.title);
        const combined = `${r.title} ${r.snippet}`;

        // Individual owners: mailing-address business phones are noise.
        // Only record if there is an explicit name match (rare for personal names).
        if (!isIndividual || nameMatch) {
          for (const p of extractPhones(combined)) {
            recordPhone(phoneCands, p, "mailing", r.url, r.title, nameMatch);
          }
        } else {
          evidence.push(`skipped: individual owner + mailing business "${r.title}" (no name match)`);
        }

        for (const e of extractEmails(combined)) {
          recordEmail(emailCands, e, "mailing", r.url);
        }
        if (r.title && relatedCompanies.length < opts.maxRelated) {
          relatedCompanies.push({ name: r.title, url: r.url });
        }
      }
    }
  }

  // Step 4 — related company lookup.
  const relatedToSearch = relatedCompanies.slice(0, opts.maxRelated);
  for (const rel of relatedToSearch) {
    const res = await opts.searchFn(rel.name);
    if (!res.ok) continue;
    evidence.push(`related_query: "${rel.name}" → ${res.results.length} results`);
    for (const r of res.results.slice(0, 2)) {
      if (isJunkResult(r.title, r.url)) continue;
      const nameMatch = hasNameOverlap(ownerName, r.title);
      if (!isIndividual || nameMatch) {
        for (const p of extractPhones(`${r.title} ${r.snippet}`)) {
          recordPhone(phoneCands, p, "related", r.url, rel.name, nameMatch);
        }
      }
    }
  }

  // Step 5 — score, filter, and select best candidate.
  const scored = phoneCands
    .map((c) => ({ ...c, score: scorePhoneCandidate(c) }))
    .sort((a, b) => b.score - a.score);

  // Three selection tracks with different confidence bars:
  //   direct/page: requires score ≥ 3 (medium confidence)
  //   mailing/related: always promoted — same-address co-location is a strong signal
  //   directory: pages_jaunes / 411.ca with explicit name match
  const directBest = scored.find(
    (c) => c.score >= 3 && (c.source === "direct_entity" || c.source === "page"),
  ) || null;
  const mailingBest = scored
    .filter((c) => c.source === "mailing" || c.source === "related")
    .sort((a, b) => b.score - a.score)[0] || null;
  const directoryBest = scored.find(
    (c) => (c.source === "pages_jaunes" || c.source === "411") && c.nameMatch,
  ) || null;
  const bestCand = directBest || mailingBest || directoryBest || null;

  let bestPhone = null;
  let bestPhoneBelongsTo = null;
  let phoneRelationship = null;
  let confidence = "low";
  let status = "no_contact_found";

  if (bestCand) {
    bestPhone = bestCand.raw;
    bestPhoneBelongsTo = bestCand.belongsTo || null;

    if (bestCand.source === "direct_entity" || bestCand.source === "page") {
      if (bestCand.nameMatch) {
        status = "ready_to_call";
        confidence = confidenceFromScore(bestCand.score);
        phoneRelationship = "direct_entity_match";
      } else {
        status = "needs_review";
        confidence = "low";
        phoneRelationship = bestCand.source;
      }
    } else if (bestCand.source === "mailing" || bestCand.source === "related") {
      // Same mailing address is a strong match — no nameMatch required.
      status = "ready_to_call";
      const isREContext = hasRealEstateKeyword(bestCand.belongsTo || "");
      confidence = isREContext ? "high" : "medium";
      phoneRelationship = isREContext
        ? "related_company_same_mailing_address"
        : "same_mailing_address_contact";
    } else if (bestCand.source === "pages_jaunes" || bestCand.source === "411") {
      status = "ready_to_call";
      confidence = "medium";
      phoneRelationship = "directory_match";
    }

    evidence.push(
      `best_phone: ${bestPhone} from "${bestPhoneBelongsTo}" ` +
      `(score=${bestCand.score}, nameMatch=${bestCand.nameMatch}, source=${bestCand.source}, ` +
      `relationship=${phoneRelationship})`,
    );
  } else if (scored.length > 0) {
    // Direct/page candidates exist but none met the medium-confidence bar; no mailing match.
    status = "needs_review";
    confidence = "low";
    evidence.push(
      `low_confidence_only: ${scored.length} candidate(s), best score=${scored[0].score} — bestPhone withheld`,
    );
  } else if (emailCands.length > 0) {
    status = "ready_to_email";
    confidence = "medium";
  }

  return {
    ...base,
    bestPhone,
    bestPhoneBelongsTo,
    phoneRelationship,
    bestEmail: emailCands[0]?.email || null,
    bestWebsite: websiteCands[0]?.url || null,
    phoneCandidates: scored,
    emailCandidates: emailCands,
    websiteCandidates: websiteCands,
    relatedCompanies,
    evidence,
    confidence,
    status,
  };
}

/* ─── Candidate list helpers ─────────────────────────────────────────────── */

function recordPhone(list, { digits, raw }, source, url, belongsTo, nameMatch, opts = {}) {
  const existing = list.find((c) => c.digits === digits && c.source === source);
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    if (nameMatch) existing.nameMatch = true;
    if (opts.relationship && !existing.relationship) existing.relationship = opts.relationship;
    if (opts.sourceQuality && !existing.sourceQuality) existing.sourceQuality = opts.sourceQuality;
  } else {
    list.push({
      digits, raw, source,
      url: url || "", belongsTo: belongsTo || "",
      occurrences: 1, nameMatch: !!nameMatch,
      relationship: opts.relationship || null,
      sourceQuality: opts.sourceQuality || null,
    });
  }
}

// Email-prefix patterns that we always reject (privacy/legal/system mailboxes).
// Generic mailboxes like info@, contact@, admin@ are intentionally NOT in this
// set — they are valid contact addresses for many small businesses and the
// caller decides their confidence level.
const JUNK_EMAIL_PREFIX_RE =
  /^(?:noreply|no-reply|no_reply|privacy|abuse|legal|webmaster|unsubscribe|bounce|postmaster|mailer-daemon|spam|phishing)$/i;

export function isJunkEmail(email) {
  const e = String(email || "").toLowerCase().trim();
  if (!e.includes("@")) return true;
  const local = e.split("@")[0] || "";
  return JUNK_EMAIL_PREFIX_RE.test(local);
}

function recordEmail(list, email, source, url, opts = {}) {
  const lower = String(email || "").toLowerCase().trim();
  if (!lower || isJunkEmail(lower)) return;
  if (list.some((c) => c.email === lower)) return;
  list.push({
    email: lower,
    source,
    source_url: url || "",
    url: url || "", // legacy alias kept for existing callers
    email_owner_name: opts.belongsTo || "",
    relationship_to_lead_owner: opts.relationship || source,
    confidence: opts.confidence || "low",
    evidence: opts.evidence || "",
    nameMatch: !!opts.nameMatch,
  });
}

function recordWebsite(list, url, source, nameMatch) {
  if (!list.some((c) => c.url === url)) {
    list.push({ url, source, nameMatch: !!nameMatch });
  }
}

/* ─── Local query builder ────────────────────────────────────────────────── */

const JUNK_NAME_RE = /^(?:\d{6,8}|[\d\-]{10,30}|[a-z]{0,3}\d+[a-z]{0,3})$/i;
function looksLikeJunkLocal(name) {
  if (!name) return true;
  return JUNK_NAME_RE.test(String(name).trim());
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
