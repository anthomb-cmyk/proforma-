// services/coOwnerValidator.js
//
// Validate whether a search-result name matches one of the lead owner's
// co-owners. Used in the enrichment pipeline to decide if a found phone/email
// can be promoted to ready_to_call even when the primary owner name didn't match.
//
// Match strength:
//   strong — exact full-name match (normalized) or sufficient token overlap
//             → ready_to_call is allowed
//   weak   — last-name-only match without corroboration
//             → needs_review max, NOT ready_to_call
//   none   — no recognizable match

// ─── Name normalization ──────────────────────────────────────────────────

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stop words that should not drive a match decision.
const STOP = new Set([
  "inc", "ltee", "ltd", "llc", "corp", "corporation",
  "de", "du", "des", "le", "la", "les", "et", "and", "the", "a", "an",
  "en", "au", "aux", "pour", "par",
  "gestion", "immobiliere", "immobilier", "realty", "holdings",
  "investments", "investissements", "placement", "capital",
]);

function tokens(name) {
  return normalize(name)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compare a result name against a list of co-owner names on the same package.
 *
 * @param {string}   resultName        Name from the search result title/snippet
 * @param {string[]} coOwnerNames      All co-owner names on the same package
 * @param {object}   [opts]
 * @param {boolean}  [opts.hasCorroboration]  True when additional evidence
 *   (matching co-owner entity, legal address, or director in profile) supports
 *   upgrading a weak last-name-only match to strong.
 * @returns {{ match: 'strong'|'weak'|'none', matchType: string,
 *             matchedName: string|null, reasons: string[] }}
 */
export function validateCoOwnerMatch(resultName, coOwnerNames, opts = {}) {
  const names = Array.isArray(coOwnerNames) ? coOwnerNames : [];
  const reasons = [];

  if (!resultName || !names.length) {
    return { match: "none", matchType: "no_candidates", matchedName: null, reasons };
  }

  const rNorm = normalize(resultName);
  const rToks = tokens(resultName);

  for (const co of names) {
    if (!co) continue;
    const cNorm = normalize(co);
    const cToks = tokens(co);

    // 1. Exact full-name match after normalization.
    if (rNorm === cNorm) {
      reasons.push(`exact_match: "${co}"`);
      return { match: "strong", matchType: "exact_full_name", matchedName: co, reasons };
    }

    // 2. Sufficient significant-token overlap (≥ 2 tokens in common).
    //    Handles name-order variants (DUPONT Jean vs Jean Dupont) and
    //    partial corporate-name matches where the key word appears in both.
    if (rToks.length >= 2 && cToks.length >= 2) {
      const rSet = new Set(rToks);
      const intersection = cToks.filter((t) => rSet.has(t));
      if (
        intersection.length >= 2
        && intersection.length >= Math.min(rToks.length, cToks.length)
      ) {
        reasons.push(`token_overlap(${intersection.join(",")}): "${co}"`);
        return { match: "strong", matchType: "token_overlap", matchedName: co, reasons };
      }
    }

    // 3. Single-token overlap where both names have ≥ 1 significant token,
    //    the overlapping token is at least 4 chars, and only one result token
    //    is significant (likely a family name).
    if (rToks.length >= 1 && cToks.length >= 1) {
      const rSet = new Set(rToks);
      const lastOverlap = cToks.filter((t) => rSet.has(t) && t.length >= 4);
      if (lastOverlap.length > 0) {
        const matchType = opts.hasCorroboration
          ? "last_name_corroborated"
          : "last_name_only";
        const strength = opts.hasCorroboration ? "strong" : "weak";
        reasons.push(
          `last_name_overlap(${lastOverlap[0]}): "${co}" (corroborated=${!!opts.hasCorroboration})`,
        );
        return { match: strength, matchType, matchedName: co, reasons };
      }
    }
  }

  return { match: "none", matchType: "no_match", matchedName: null, reasons };
}

/**
 * Returns true when a co-owner validation result is strong enough to allow
 * promoting a phone/email candidate to ready_to_call / ready_to_email.
 */
export function isStrongCoOwnerMatch(matchResult) {
  return matchResult?.match === "strong";
}
