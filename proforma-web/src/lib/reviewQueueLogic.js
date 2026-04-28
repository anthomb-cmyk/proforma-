// proforma-web/src/lib/reviewQueueLogic.js
//
// Pure logic for the contact-enrichment review queue. The component is a
// thin presentational wrapper over these functions so they can be tested
// without @testing-library.

// Status values that land in the review queue.
export const REVIEW_STATUSES = new Set(["needs_review", "ready_to_email"]);

// Decision values stored per package in the review queue.
//   "accepted" — user promoted to ready_to_call
//   "rejected" — user marked the candidate as never-call
//   "skipped"  — user wants to revisit later (still in queue)
//   undefined  — not yet acted upon
export const DECISIONS = ["accepted", "rejected", "skipped"];

/**
 * Filter the enriched results into the review queue.
 * @param {Iterable<{packageKey:string,result:object}>} entries  Results from
 *   `[...allEnrichedResults.entries()]` — paired [packageKey, result].
 * @param {Map<string,{decision:string}>} decisions  Per-key decisions.
 * @param {object} [opts]
 * @param {boolean} [opts.includeAccepted=false]  Show accepted rows too.
 * @param {boolean} [opts.includeRejected=false]  Show rejected rows too.
 */
export function filterReviewableEntries(entries, decisions, opts = {}) {
  const out = [];
  const dec = decisions || new Map();
  for (const [key, result] of entries) {
    if (!result) continue;
    if (!REVIEW_STATUSES.has(result.status)) continue;
    const d = dec.get(key)?.decision;
    if (d === "accepted" && !opts.includeAccepted) continue;
    if (d === "rejected" && !opts.includeRejected) continue;
    out.push({ packageKey: key, result, decision: d || null });
  }
  return out;
}

/** Summary counts across the whole session — for the live scorecard. */
export function summarizeSession(allEnrichedResults, decisions) {
  const total = allEnrichedResults?.size || 0;
  let ready = 0, review = 0, email = 0, none = 0, skipped = 0;
  let accepted = 0, rejected = 0, deferred = 0;
  for (const [key, r] of (allEnrichedResults || new Map())) {
    if (!r) continue;
    const d = decisions?.get(key)?.decision;
    if (d === "accepted") accepted++;
    else if (d === "rejected") rejected++;
    else if (d === "skipped") deferred++;
    if (r.status === "ready_to_call") ready++;
    else if (r.status === "needs_review") review++;
    else if (r.status === "ready_to_email") email++;
    else if (r.status === "skipped_existing_phone") skipped++;
    else none++;
  }
  return { total, ready, review, email, none, skipped, accepted, rejected, deferred };
}

/**
 * Promote a review-queue result when the user accepts it.
 * Returns a NEW result object — the caller should replace it in the map.
 *
 * Gating (P1 audit fix 3):
 *   - phone found  → ready_to_call (existing behaviour)
 *   - no phone but email exists → ready_to_email (not ready_to_call)
 *   - no phone and no email → keep current status, record decision only
 *
 * This prevents junk leads where status === "ready_to_call" but bestPhone
 * is null, which breaks downstream CRM assumptions.
 */
export function applyAcceptedDecision(result, candidatePhone) {
  const r = { ...(result || {}) };
  const phone = candidatePhone?.raw || candidatePhone?.phone || r.bestPhone || null;
  const evidence = [...(r.evidence || [])];
  if (phone) {
    r.status = "ready_to_call";
    r.bestPhone = phone;
    if (candidatePhone) {
      r.bestPhoneBelongsTo = candidatePhone.belongsTo || r.bestPhoneBelongsTo;
      r.phoneRelationship = candidatePhone.relationship_to_lead_owner
        || candidatePhone.relationship
        || r.phoneRelationship
        || "manual_review_accepted";
      r.confidence = candidatePhone.confidence || r.confidence || "medium";
    } else if (!r.phoneRelationship) {
      r.phoneRelationship = "manual_review_accepted";
    }
    evidence.push("manual_accept: promoted to ready_to_call by user");
  } else if (r.bestEmail) {
    // No phone but email exists — promote to ready_to_email instead.
    r.status = "ready_to_email";
    evidence.push("manual_accept: no phone — promoted to ready_to_email by user");
  } else {
    // Nothing to call/email — preserve current status, just record the decision.
    evidence.push(`manual_accept: no contact data — kept as ${r.status || "unknown"}`);
  }
  r.evidence = evidence;
  return r;
}

/** Returns a normalized phone-candidate object for never-call listing. */
export function pickPrimaryCandidate(result) {
  if (!result) return null;
  if (result.bestPhone) {
    return {
      raw: result.bestPhone,
      digits: String(result.bestPhone).replace(/\D+/g, ""),
      belongsTo: result.bestPhoneBelongsTo || "",
      relationship: result.phoneRelationship || "",
      confidence: result.confidence || "",
    };
  }
  const cands = result.phoneCandidates || [];
  return cands[0] || null;
}

// ─── Phase 4: Visual signals + recommendation ────────────────────────────────

// Stop words filtered out during name-token overlap checks.
const NAME_STOP_WORDS = new Set([
  "inc", "ltd", "ltee", "ltee.", "gestion", "immobilier", "immobiliere",
  "immobilière", "holdings", "investments", "realty", "realties",
  "properties", "proprietes", "propriétés", "group", "groupe", "de", "du",
  "la", "le", "les", "et", "and", "or", "the", "a", "an",
]);

// Toll-free number prefixes (NANP area codes).
const TOLL_FREE_RE = /^(?:\+?1[-.\s]?)?(?:800|888|866|877|855|844|833|822)/;

// Generic listing/directory hostnames that are not direct business websites.
const GENERIC_DIRECTORY_HOSTS = new Set([
  "canpages.ca", "yellowpages.ca", "pagesjaunes.ca", "yelp.com",
  "houzz.com", "showmelocal.com", "anugo.com", "zoominfo.com",
  "bbb.org", "chamberofcommerce.com", "manta.com", "cylex.ca",
  "411.ca", "canada411.ca", "whitepages.ca", "tupalo.ca",
]);

/**
 * Normalize a string to lowercase ASCII tokens (≥ 1 char, strip diacritics).
 * @param {string} v
 * @returns {string[]}
 */
function nameTokens(v) {
  if (!v) return [];
  return String(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Return true when the URL hostname belongs to a generic directory.
 * @param {string} url
 * @returns {boolean}
 */
function isGenericDirectoryUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    return GENERIC_DIRECTORY_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Return distinctive tokens (≥ 4 chars, not a stop word) from a string.
 * @param {string} v
 * @returns {string[]}
 */
function distinctiveTokens(v) {
  return nameTokens(v).filter((t) => t.length >= 4 && !NAME_STOP_WORDS.has(t));
}

/**
 * Compute visual signals + a recommendation for a single review-queue result.
 *
 * @param {object} result  A pipeline result object (bestPhone, bestPhoneBelongsTo, …)
 * @returns {{
 *   signals: Array<{kind: 'positive'|'negative'|'neutral', icon: string, text: string}>,
 *   recommendation: 'accept'|'reject'|'verify'
 * }}
 */
export function computeReviewSignals(result) {
  if (!result || typeof result !== "object") {
    return { signals: [], recommendation: "verify" };
  }

  const signals = [];

  const ownerName = String(result.lead_owner_name || "").trim();
  const belongsTo = String(result.bestPhoneBelongsTo || "").trim();
  const bestPhone = String(result.bestPhone || "").trim();
  const relationship = String(result.phoneRelationship || "").trim();
  const bestWebsite = String(result.bestWebsite || "").trim();
  const phoneCandidates = Array.isArray(result.phoneCandidates) ? result.phoneCandidates : [];

  // ── Positive signals ──────────────────────────────────────────────────────

  // 1. URL contains a non-stop-word token from owner name
  if (bestWebsite && ownerName) {
    const ownerToks = distinctiveTokens(ownerName);
    if (ownerToks.length > 0) {
      const urlLower = bestWebsite.toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      if (ownerToks.some((t) => urlLower.includes(t))) {
        signals.push({ kind: "positive", icon: "✓", text: "URL matches owner name" });
      }
    }
  }

  // 2. bestPhoneBelongsTo shares ≥1 distinctive token with lead_owner_name
  if (belongsTo && ownerName) {
    const ownerDistinct = distinctiveTokens(ownerName);
    const belongsDistinct = distinctiveTokens(belongsTo);
    const ownerSet = new Set(ownerDistinct);
    if (ownerDistinct.length > 0 && belongsDistinct.some((t) => ownerSet.has(t))) {
      signals.push({ kind: "positive", icon: "✓", text: '"Belongs to" matches owner' });
    }
  }

  // 3. Exact director / co-owner match
  if (relationship === "exact_director_match" || relationship === "co_owner_match") {
    signals.push({ kind: "positive", icon: "✓", text: "Exact director/co-owner match" });
  }

  // 4. Top candidate with nameMatch=true AND score >= 5
  const topCand = phoneCandidates[0] || null;
  if (topCand && topCand.nameMatch === true && (topCand.score || 0) >= 5) {
    signals.push({ kind: "positive", icon: "✓", text: "High confidence match" });
  }

  // ── Negative signals ──────────────────────────────────────────────────────

  // 5. Toll-free number
  if (bestPhone && TOLL_FREE_RE.test(bestPhone.replace(/[\s.()\-]/g, ""))) {
    signals.push({ kind: "negative", icon: "⚠", text: "Toll-free number" });
  }

  // 6. URL is a generic directory listing AND no name match
  if (bestWebsite) {
    const topNameMatch = phoneCandidates[0]?.nameMatch === true;
    if (isGenericDirectoryUrl(bestWebsite) && !topNameMatch) {
      signals.push({ kind: "negative", icon: "⚠", text: "Generic directory listing" });
    }
  }

  // 7. No token overlap between owner name and bestPhoneBelongsTo (after stop words)
  if (ownerName && belongsTo) {
    const ownerDistinct = distinctiveTokens(ownerName);
    const belongsDistinct = distinctiveTokens(belongsTo);
    const ownerSet = new Set(ownerDistinct);
    // Only fire when we have enough distinctive tokens to compare meaningfully.
    if (ownerDistinct.length > 0 && belongsDistinct.length > 0) {
      if (!belongsDistinct.some((t) => ownerSet.has(t))) {
        signals.push({ kind: "negative", icon: "⚠", text: "No name overlap with owner" });
      }
    }
  }

  // ── Neutral signals ───────────────────────────────────────────────────────

  // 8. Places fallback (external match — always needs a human eye)
  if (relationship === "places_fallback") {
    signals.push({ kind: "neutral", icon: "ⓘ", text: "Found via Places fallback" });
  }

  // ── Recommendation ────────────────────────────────────────────────────────

  const hasPositive = signals.some((s) => s.kind === "positive");
  const hasNegative = signals.some((s) => s.kind === "negative");

  let recommendation;
  if (hasPositive && !hasNegative) {
    recommendation = "accept";
  } else if (hasNegative && !hasPositive) {
    recommendation = "reject";
  } else {
    recommendation = "verify";
  }

  return { signals, recommendation };
}
