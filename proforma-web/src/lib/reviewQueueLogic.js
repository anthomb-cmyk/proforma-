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
 * Promote a needs_review result to ready_to_call when the user accepts it.
 * Returns a NEW result object — the caller should replace it in the map.
 */
export function applyAcceptedDecision(result, candidatePhone) {
  const r = { ...(result || {}) };
  r.status = "ready_to_call";
  if (candidatePhone) {
    r.bestPhone = candidatePhone.raw || candidatePhone.phone || r.bestPhone;
    r.bestPhoneBelongsTo = candidatePhone.belongsTo || r.bestPhoneBelongsTo;
    r.phoneRelationship = candidatePhone.relationship_to_lead_owner
      || candidatePhone.relationship
      || r.phoneRelationship
      || "manual_review_accepted";
    r.confidence = candidatePhone.confidence || r.confidence || "medium";
  } else if (!r.phoneRelationship) {
    r.phoneRelationship = "manual_review_accepted";
  }
  r.evidence = [...(r.evidence || []), `manual_accept: promoted to ready_to_call by user`];
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
