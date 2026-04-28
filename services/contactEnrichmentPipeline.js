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
  const maxAddressDiscovery = Number.isFinite(options.maxAddressDiscoveryQueries)
    ? Math.min(options.maxAddressDiscoveryQueries, MAX_ADDRESS_DISCOVERY_QUERIES)
    : MAX_ADDRESS_DISCOVERY_QUERIES;
  const maxProfileExpansion = Number.isFinite(options.maxProfileExpansionQueries)
    ? Math.min(options.maxProfileExpansionQueries, MAX_PROFILE_EXPANSION_QUERIES)
    : MAX_PROFILE_EXPANSION_QUERIES;

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
      maxAddressDiscovery,
      maxProfileExpansion,
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
  // Company-profile (B2BHint / registre / OpenCorporates) results gathered
  // across all tracks. Used in Step 4b for director / related-company expansion.
  const profileResults = [];

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
        const cls = classifySource({ url: r.url, title: r.title, snippet: r.snippet });
        if (isRejectedSource(cls.quality)) {
          evidence.push(`rejected: "${r.title}" (${cls.quality}: ${cls.reasons.join(",")})`);
          continue;
        }
        if (cls.quality === "company_profile") {
          profileResults.push(r);
          evidence.push(`direct_profile: "${r.title}" at ${r.url}`);
        }
        const nameMatch = hasNameOverlap(ownerName, r.title);
        const combined = `${r.title} ${r.snippet}`;
        for (const p of extractPhones(combined)) {
          recordPhone(phoneCands, p, "direct_entity", r.url, r.title, nameMatch, {
            sourceQuality: cls.quality,
          });
        }
        for (const e of extractEmails(combined)) {
          const conf = nameMatch
            ? "high"
            : (cls.quality === "real_estate" || cls.quality === "private_business")
              ? "medium"
              : "low";
          recordEmail(emailCands, e, "direct_entity", r.url, {
            belongsTo: r.title,
            nameMatch,
            confidence: conf,
            evidence: `direct: ${cls.quality}`,
          });
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

  // Step 4a — address-discovery track.
  //
  // Runs B2BHint-style queries against each mailing address to surface
  // companies/entities co-located there. Capped at MAX_ADDRESS_DISCOVERY_QUERIES
  // (7) per package across all addresses. Results pass through the source
  // quality classifier; government and junk sources are rejected outright.
  // Phones/emails picked up here get the "company_discovered_from_same_mailing_address"
  // relationship label so downstream callers can distinguish them from
  // direct-name matches.
  if (useMailingQueries || strategy === "mailing_address_only") {
    const addrQueries = buildAddressDiscoveryQueriesLocal(pkg, opts.maxAddressDiscovery);
    for (const q of addrQueries) {
      const res = await opts.searchFn(q);
      if (!res.ok) {
        evidence.push(`addr_discovery_failed: ${res.error}`);
        continue;
      }
      evidence.push(`addr_discovery: "${q}" → ${res.results.length} results`);
      for (const r of res.results) {
        const cls = classifySource({ url: r.url, title: r.title, snippet: r.snippet });
        if (isRejectedSource(cls.quality)) {
          evidence.push(`rejected: "${r.title}" (${cls.quality}: ${cls.reasons.join(",")})`);
          continue;
        }

        if (cls.quality === "company_profile") {
          profileResults.push(r);
          evidence.push(`addr_profile: "${r.title}" at ${r.url}`);
          // Profile results without explicit phone in snippet are evidence-only.
          // Still extract any phone/email that happens to appear in the snippet,
          // labeled as company_profile_expansion.
        }

        const nameMatch = hasNameOverlap(ownerName, r.title);
        const combined = `${r.title} ${r.snippet}`;

        // Individual owners: only accept address-discovery phones with nameMatch.
        if (!isIndividual || nameMatch) {
          for (const p of extractPhones(combined)) {
            recordPhone(phoneCands, p, "mailing", r.url, r.title, nameMatch, {
              relationship: cls.quality === "company_profile"
                ? "company_profile_expansion"
                : "company_discovered_from_same_mailing_address",
              sourceQuality: cls.quality,
            });
          }
        }

        for (const e of extractEmails(combined)) {
          const emailConfidence =
            (cls.quality === "real_estate" || cls.quality === "private_business") && nameMatch
              ? "high"
              : (cls.quality === "real_estate" || cls.quality === "private_business")
                ? "medium-high"
                : nameMatch ? "medium" : "low";
          recordEmail(emailCands, e, "mailing", r.url, {
            belongsTo: r.title,
            nameMatch,
            relationship: cls.quality === "company_profile"
              ? "company_profile_expansion"
              : "company_discovered_from_same_mailing_address",
            confidence: emailConfidence,
            evidence: `address-discovery: ${cls.quality}`,
          });
        }

        if (r.title && relatedCompanies.length < opts.maxRelated) {
          relatedCompanies.push({ name: r.title, url: r.url });
        }
      }
    }
  }

  // Step 4b — company-profile expansion.
  //
  // For every B2BHint / registre / OpenCorporates result captured in Step 1
  // or Step 4a, extract structured profile data and run expansion queries
  // for each director and related company anchored at the mailing address.
  // Profile pages without an explicit phone in their snippet contribute
  // evidence + expansion targets only — never a contact result on their own.
  if (profileResults.length > 0) {
    const mailingAnchor = [
      pkg.mailing_address,
      pkg.mailing_city,
      pkg.mailing_province,
    ].filter(Boolean).join(", ");

    const expansionQueriesSet = new Set();
    const profiles = [];
    for (const r of profileResults) {
      const profile = extractCompanyProfile(r);
      if (!profile) continue;
      profiles.push(profile);
      evidence.push(
        `company_profile: "${profile.companyName}" NEQ=${profile.enterpriseNumber || "?"}`
        + ` directors=${profile.directors.length} related=${profile.relatedCompanies.length}`,
      );

      // Legal-address corroboration: when the profile's legal address contains
      // the mailing street/postal, every existing candidate from this profile
      // gains a "legal_address_match" hint.
      if (profile.legalAddress && pkg.mailing_address) {
        const la = profile.legalAddress.toLowerCase();
        const ma = String(pkg.mailing_address || "").toLowerCase();
        if (la.includes(ma) || ma.includes(la)) {
          evidence.push(`legal_address_match: "${profile.legalAddress}" ↔ "${pkg.mailing_address}"`);
        }
      }

      for (const q of buildProfileExpansionQueries(profile, mailingAnchor)) {
        expansionQueriesSet.add(q);
      }
    }

    const expansionQueries = [...expansionQueriesSet].slice(0, opts.maxProfileExpansion);
    for (const q of expansionQueries) {
      const res = await opts.searchFn(q);
      if (!res.ok) {
        evidence.push(`profile_expansion_failed: "${q}" → ${res.error}`);
        continue;
      }
      evidence.push(`profile_expansion: "${q}" → ${res.results.length} results`);
      for (const r of res.results) {
        const cls = classifySource({ url: r.url, title: r.title, snippet: r.snippet });
        if (isRejectedSource(cls.quality)) {
          evidence.push(`rejected: "${r.title}" (${cls.quality})`);
          continue;
        }
        const nameMatch = hasNameOverlap(ownerName, r.title);
        const combined = `${r.title} ${r.snippet}`;

        // Exact-director check: does any extracted director name match the
        // result name? When it does, this is an exact_director_match — the
        // strongest possible same-mailing signal.
        let isExactDirector = false;
        for (const profile of profiles) {
          for (const dir of profile.directors || []) {
            const dm = validateCoOwnerMatch(r.title, [dir]);
            if (dm.matchType === "exact_full_name" || dm.matchType === "token_overlap") {
              isExactDirector = true;
              break;
            }
          }
          if (isExactDirector) break;
        }

        const relationship = isExactDirector
          ? "exact_director_match"
          : (nameMatch ? "company_profile_expansion" : "related_company_from_profile");

        if (!isIndividual || nameMatch || isExactDirector) {
          for (const p of extractPhones(combined)) {
            recordPhone(phoneCands, p, "direct_entity", r.url, r.title,
              nameMatch || isExactDirector, {
                relationship,
                sourceQuality: cls.quality,
              });
          }
        }
        for (const e of extractEmails(combined)) {
          const conf = isExactDirector
            ? "high"
            : (nameMatch ? "medium" : "low");
          recordEmail(emailCands, e, "direct_entity", r.url, {
            belongsTo: r.title,
            nameMatch: nameMatch || isExactDirector,
            relationship,
            confidence: conf,
            evidence: `profile_expansion: ${cls.quality}`,
          });
        }
      }
    }
  }

  // Step 4.5 — co-owner validation pass.
  //
  // Walk every candidate (phones + emails) and check whether its result name
  // matches any of the lead owner's co-owners. A strong match (exact full
  // name OR ≥ 2-token overlap) upgrades nameMatch and tags the candidate with
  // a co_owner_match relationship — so a numbered company's co-owner mentioned
  // on a real-estate site can be promoted to ready_to_call. A weak (last-name
  // only) match never upgrades on its own; it gets recorded for needs_review.
  const coOwnerNames = Array.isArray(pkg.coOwnerNames) && pkg.coOwnerNames.length
    ? pkg.coOwnerNames
    : (Array.isArray(pkg.co_owners) ? pkg.co_owners : []);
  if (coOwnerNames.length > 0) {
    for (const c of phoneCands) {
      if (c.nameMatch) continue;
      const m = validateCoOwnerMatch(c.belongsTo || "", coOwnerNames);
      if (isStrongCoOwnerMatch(m)) {
        c.nameMatch = true;
        c.coOwnerMatch = m;
        c.relationship = c.relationship || "co_owner_match";
        evidence.push(
          `co_owner_upgrade: phone "${c.belongsTo}" → "${m.matchedName}" (${m.matchType})`,
        );
      } else if (m.match === "weak") {
        c.weakCoOwnerMatch = m.matchedName;
        evidence.push(
          `co_owner_weak: phone "${c.belongsTo}" shares only last name with "${m.matchedName}"`,
        );
      }
    }
    for (const e of emailCands) {
      if (e.nameMatch) continue;
      const m = validateCoOwnerMatch(e.email_owner_name || "", coOwnerNames);
      if (isStrongCoOwnerMatch(m)) {
        e.nameMatch = true;
        e.coOwnerMatch = m;
        e.relationship_to_lead_owner = e.relationship_to_lead_owner === e.source
          ? "co_owner_match"
          : e.relationship_to_lead_owner;
        if (e.confidence === "low") e.confidence = "medium";
        evidence.push(
          `co_owner_upgrade: email "${e.email_owner_name}" → "${m.matchedName}" (${m.matchType})`,
        );
      } else if (m.match === "weak") {
        e.weakCoOwnerMatch = m.matchedName;
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
        phoneRelationship = bestCand.relationship || "direct_entity_match";
      } else {
        status = "needs_review";
        confidence = "low";
        phoneRelationship = bestCand.relationship || bestCand.source;
      }
    } else if (bestCand.source === "mailing" || bestCand.source === "related") {
      // Same mailing address is a strong match — no nameMatch required.
      status = "ready_to_call";
      const isREContext = hasRealEstateKeyword(bestCand.belongsTo || "");
      confidence = isREContext ? "high" : "medium";
      phoneRelationship = bestCand.relationship || (isREContext
        ? "related_company_same_mailing_address"
        : "same_mailing_address_contact");
    } else if (bestCand.source === "pages_jaunes" || bestCand.source === "411") {
      status = "ready_to_call";
      confidence = "medium";
      phoneRelationship = bestCand.relationship || "directory_match";
    }

    // Co-owner-only matches downgrade-protect: if the only signal was a weak
    // last-name match (no upgrade), force needs_review. Strong co-owner matches
    // already had nameMatch upgraded above, so they pass through normally.
    if (bestCand.weakCoOwnerMatch && !bestCand.nameMatch) {
      status = "needs_review";
      confidence = "low";
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
    // First-set wins for relationship/sourceQuality so the legacy mailing
    // track (Step 3) keeps its un-labeled candidates intact when the
    // address-discovery track (Step 4a) would otherwise relabel them.
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

/**
 * Build address-discovery queries — up to maxQueries (default 7) per package.
 * For packages with mailingAddresses[] populated, queries are generated for
 * each address until the cap is reached. Falls back to flat mailing_* fields
 * for legacy lead-like packages.
 *
 * Templates (in priority order — most specific first):
 *   "<addr> b2bhint"
 *   "\"<addr>\" Québec Inc"
 *   "\"<addr>\" company"
 *   "\"<addr>\" immobilier gestion"
 *   "\"<addr>\" site:b2bhint.com"
 *   "\"<addr>\" entreprise"
 *   "\"<addr>\" gestion immobilière"
 */
export function buildAddressDiscoveryQueriesLocal(pkg, maxQueries = MAX_ADDRESS_DISCOVERY_QUERIES) {
  const cap = Math.min(maxQueries, MAX_ADDRESS_DISCOVERY_QUERIES);
  const sources = [];

  if (Array.isArray(pkg.mailingAddresses) && pkg.mailingAddresses.length > 0) {
    for (const a of pkg.mailingAddresses) {
      const street = String(a.street || "").trim();
      const city = String(a.city || "").trim();
      const addrStr = [street, city].filter(Boolean).join(", ");
      if (addrStr) sources.push(addrStr);
    }
  } else {
    const street = String(pkg.mailing_address || "").trim();
    const city = String(pkg.mailing_city || "").trim();
    const addrStr = [street, city].filter(Boolean).join(", ");
    if (addrStr) sources.push(addrStr);
  }

  if (!sources.length) return [];

  const TEMPLATES = [
    (a) => `${a} b2bhint`,
    (a) => `"${a}" Québec Inc`,
    (a) => `"${a}" company`,
    (a) => `"${a}" immobilier gestion`,
    (a) => `"${a}" site:b2bhint.com`,
    (a) => `"${a}" entreprise`,
    (a) => `"${a}" gestion immobilière`,
  ];

  const seen = new Set();
  const out = [];
  for (const addr of sources) {
    for (const tmpl of TEMPLATES) {
      if (out.length >= cap) return out;
      const q = tmpl(addr);
      const k = q.toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(q);
    }
    if (out.length >= cap) return out;
  }
  return out;
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
