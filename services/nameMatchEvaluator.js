// services/nameMatchEvaluator.js
//
// Decide whether a search-result name actually represents the lead owner
// (or one of their known associates), distinguishing person results from
// entity results so a shared family name never silently becomes nameMatch.
//
// Why this module exists separately from coOwnerValidator:
//   - coOwnerValidator answers "does this name match any name in this list?"
//     (used after candidates already exist).
//   - nameMatchEvaluator answers "should we trust this result as belonging
//     to the lead owner?" — it gates whether a candidate is recorded with
//     nameMatch=true in the first place, and surfaces weakNameMatch=true
//     for the cases that previously slipped through (generic real-estate
//     vocabulary, single-shared-family-name).
//
// Spec — for an ENTITY owner name (e.g. "GESTION IMMOBILIÈRE CHOINIÈRE INC."):
//   - vs ENTITY result: nameMatch only when ≥ 2 distinct meaningful tokens
//     overlap (single shared family token is not enough).
//   - vs PERSON result: nameMatch only when one of:
//        (a) result is exact full-name match to a known director/officer
//            extracted from a company-profile page,
//        (b) result is exact full-name match to a co-owner of the package,
//        (c) the entity name itself appears in the result title or snippet
//            alongside the person's name (e.g. company website that lists a
//            broker who works for the company),
//        (d) the result is on the official owner site.
//     Otherwise: weakNameMatch=true if last name overlaps, nameMatch=false.
//
// For a PERSON owner name (e.g. "Jean Dupont"):
//   - vs PERSON result: nameMatch when normalized full names match OR
//     ≥ 2 distinct tokens overlap (handles reordered "Dupont, Jean").
//     Single shared family-name token → weakNameMatch.
//   - vs ENTITY result: nameMatch only if the entity name embeds the
//     owner's full name (rare; conservative default = no match).

// ─── Normalization ─────────────────────────────────────────────────────────

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    // Strip combining diacritics (̀-ͯ).
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Take the leading "name chunk" of a result title — search results often look
// like "Jonathan Choinière, Courtier Immobilier" or "Jean Dupont | LinkedIn"
// and only the first segment carries the candidate's actual name.
//
// We do NOT split on plain hyphens because hyphenated tokens like
// "Marie-Claire" or "MULTI-LOGEMENTS" must remain intact. A " - " (with
// surrounding spaces) is treated as a separator, but in-word "-" is not.
function leadingChunk(s) {
  return String(s || "")
    .replace(/\s+[—–]\s+/g, "|")
    .replace(/\s-\s/g, "|")
    .split(/[,|:•·]/)[0]
    .trim();
}

// ─── Stop words ────────────────────────────────────────────────────────────

// Generic real-estate / corporate vocabulary that should NEVER drive a name
// match decision on its own. Keeping these out of the significant-token set
// is what fixes the Choinière regression: "GESTION IMMOBILIÈRE CHOINIÈRE INC."
// vs "Jonathan Choinière Courtier Immobilier" used to overlap on "immobilier"
// (corporate vocabulary) and "choinière" (single shared family token).
const STOP_WORDS = new Set([
  // Corporate suffixes
  "inc", "ltd", "ltee", "llc", "llp", "corp", "corporation", "company", "co",
  "sa", "senc", "sec", "snc", "enr", "enrg", "reg",
  // Function words
  "et", "and", "the", "a", "an",
  "le", "la", "les", "de", "du", "des", "en", "au", "aux",
  "pour", "par", "sur", "sous",
  // Generic real-estate / business vocabulary — these decided Choinière wrong.
  "gestion", "gestions", "gestionnaire",
  "immobilier", "immobiliere", "immobilieres", "immobiliers",
  "immo",
  "courtier", "courtiers", "courtage", "broker", "realtor", "agent", "agence",
  "holdings", "holding", "realty", "properties", "property",
  "investments", "investissement", "investissements", "placement", "placements",
  "capital", "capitaux", "fonds", "fond",
  "fiducie", "trust",
  "groupe", "group",
  "service", "services", "consultant", "consultants", "consulting",
  "avocat", "avocats", "avocate", "notaire", "notaires",
]);

export function significantTokens(name) {
  return normalize(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

// ─── Person / entity classification ────────────────────────────────────────

const ENTITY_SUFFIX_RE = /\b(?:inc|ltd|ltee|llc|llp|corp|corporation|company|co|sa|senc|sec|snc|enr|enrg|reg|fiducie|trust)\b\.?/i;
const ENTITY_PREFIX_RE = /^(?:gestion|fiducie|investissement|investments|placement|capital|holdings|properties|realty|immobili[eè]re?|fonds|residence|residences|r[eé]sidence|r[eé]sidences|le|la|les|société|societe|entreprise|entreprises|groupe|boulangerie|p[âa]tisserie|patisserie|restaurant|caf[ée]|cafe|bar|brasserie|garage|pharmacie|d[ée]panneur|depanneur|magasin|boutique|salon|spa|clinique|cabinet|bureau|atelier|h[ôo]tel|hotel|auberge|chalet|librairie|garderie|[ée]picerie|epicerie|gym|fitness|ferme|construction|transports|services|consulting|club|coop|cooperative|association|fondation)\b/i;
const NUMBERED_QC_CORP_RE = /\b\d{4}-?\d{4}\s*(?:qu[eé]bec|que|qc)\b/i;

export function isEntityName(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t) return false;
  if (ENTITY_SUFFIX_RE.test(t)) return true;
  if (ENTITY_PREFIX_RE.test(t)) return true;
  if (NUMBERED_QC_CORP_RE.test(t)) return true;
  return false;
}

const PERSON_NAME_RE = /^[A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){1,3}$/;
const TITLE_PREFIX_RE = /^(?:m\.?|mr\.?|mme\.?|me\.?|dr\.?|prof\.?)\s+/i;

// Does this string look like a Title-Case human name (vs ALL CAPS entity
// like "BISSONMUTCH MULTI-LOGEMENTS")? Each whitespace-separated word should
// start with a capital and contain at least one lowercase letter — single
// short articles ("De", "La", "Du") are tolerated as 2-letter Title Case.
function looksTitleCase(s) {
  return s.split(/\s+/).every((tok) => {
    const t = tok.replace(/[^A-Za-zÀ-ÿ]/g, "");
    if (!t) return true;
    if (!/^[A-ZÀ-Ý]/.test(t)) return false;
    if (t.length === 1) return true;
    if (t === t.toUpperCase()) return false;
    return true;
  });
}

export function isPersonName(s) {
  if (!s) return false;
  const head = leadingChunk(s);
  if (!head) return false;
  if (isEntityName(head)) return false;
  const stripped = head.replace(TITLE_PREFIX_RE, "").trim();
  if (!stripped) return false;
  if (!PERSON_NAME_RE.test(stripped)) return false;
  // Reject all-caps tokens — corporate names truncated without a suffix
  // (e.g. "BISSONMUTCH MULTI-LOGEMENTS") otherwise pass the shape check.
  if (!looksTitleCase(stripped)) return false;
  return true;
}

// ─── Match helpers ─────────────────────────────────────────────────────────

function exactFullNameMatch(a, b) {
  return !!a && !!b && normalize(a) === normalize(b);
}

function tokenOverlapCount(a, b) {
  const at = new Set(significantTokens(a));
  if (!at.size) return 0;
  let n = 0;
  for (const t of significantTokens(b)) {
    if (at.has(t)) n++;
  }
  return n;
}

// Distinct token-overlap with prefix tolerance (handles "dupont"/"duponts"),
// but only for tokens that are already past the stop-word filter — so
// "immobilier" / "immobiliere" do NOT contribute via this path either.
function distinctTokenOverlap(a, b) {
  const at = significantTokens(a);
  const bt = significantTokens(b);
  const matched = new Set();
  for (const x of at) {
    for (const y of bt) {
      if (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))) {
        matched.add(x);
      }
    }
  }
  return [...matched];
}

// Does the entity name appear inside the haystack as a real multi-token
// mention? Two acceptance paths:
//   (a) ≥ 2 distinct meaningful tokens overlap (so "immobilier" alone, a
//       generic vocabulary token, cannot satisfy this).
//   (b) the owner's core entity name (after stripping corporate suffixes)
//       appears as a substring of the normalized haystack and the core is
//       long enough (≥ 8 chars) that coincidence is unlikely. This handles
//       owners whose only significant token is a family name — e.g.
//       "GESTION IMMOBILIÈRE CHOINIÈRE INC." → core "gestion immobiliere
//       choiniere" — where (a) cannot fire because the owner side has just
//       one significant token.
const CORPORATE_SUFFIX_TOKENS = /\b(?:inc|ltd|ltee|llc|llp|corp|corporation|company|co|sa|senc|sec|snc|enr|enrg|reg)\b/g;
function entityNameMentioned(entityName, haystack) {
  if (!haystack) return false;
  const overlap = distinctTokenOverlap(entityName, haystack);
  if (overlap.length >= 2) return true;
  const core = normalize(entityName).replace(CORPORATE_SUFFIX_TOKENS, " ").replace(/\s+/g, " ").trim();
  if (core.length < 8) return false;
  return normalize(haystack).includes(core);
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Evaluate whether a search-result name should be trusted as belonging to
 * the lead owner (or one of their associates).
 *
 * @param {string} ownerName     The lead owner's canonical name.
 * @param {string} resultTitle   The search result title (or anchor name).
 * @param {object} [opts]
 * @param {string[]} [opts.coOwnerNames]      Co-owner names from the rôle row.
 * @param {string[]} [opts.knownDirectors]    Director/officer names extracted
 *   from any company-profile page (B2BHint / registre).
 * @param {string}  [opts.snippet]            Result snippet (used to detect
 *   entity-name mentions alongside a person name).
 * @param {boolean} [opts.isOfficialOwnerSite] True when the result URL is on
 *   the official owner-entity website.
 * @returns {{
 *   nameMatch: boolean,
 *   weakNameMatch: boolean,
 *   matchType: string,
 *   reason: string,
 *   ownerKind: 'entity'|'person',
 *   resultKind: 'entity'|'person'
 * }}
 */
export function evaluateNameMatch(ownerName, resultTitle, opts = {}) {
  const empty = (mt = "no_input", reason = "missing_input") => ({
    nameMatch: false, weakNameMatch: false, matchType: mt, reason,
    ownerKind: "entity", resultKind: "entity",
  });
  if (!ownerName || !resultTitle) return empty();

  const head = leadingChunk(resultTitle);
  const ownerKind = isEntityName(ownerName) ? "entity" : "person";
  const resultKind = isPersonName(resultTitle) ? "person" : "entity";

  // ENTITY ↔ ENTITY:
  //   - exact normalized name → strong
  //   - ≥ 2 distinct meaningful tokens overlap → strong
  //   - all of the owner's significant tokens are present in the result
  //     (even if just 1) → strong (the owner's entire distinguishing
  //     identity is matched; e.g. "Immobilier Fictif Inc." vs itself,
  //     where the only meaningful token is "fictif")
  //   - 1 token overlap but the owner has additional unmatched tokens → weak
  if (ownerKind === "entity" && resultKind === "entity") {
    if (exactFullNameMatch(ownerName, resultTitle)) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "exact_entity", reason: "exact_full_name",
        ownerKind, resultKind,
      };
    }
    const ownerSig = significantTokens(ownerName);
    const overlap = distinctTokenOverlap(ownerName, resultTitle);
    if (overlap.length >= 2) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "entity_token_overlap",
        reason: `entity_overlap:${overlap.join(",")}`,
        ownerKind, resultKind,
      };
    }
    if (overlap.length >= 1 && ownerSig.length > 0 && overlap.length === ownerSig.length) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "entity_token_overlap",
        reason: `entity_all_owner_tokens:${overlap.join(",")}`,
        ownerKind, resultKind,
      };
    }
    if (overlap.length === 1) {
      return {
        nameMatch: false, weakNameMatch: true,
        matchType: "single_entity_token_overlap",
        reason: `weak_entity_single_token:${overlap[0]}`,
        ownerKind, resultKind,
      };
    }
    return {
      nameMatch: false, weakNameMatch: false,
      matchType: "no_overlap", reason: "no_significant_overlap",
      ownerKind, resultKind,
    };
  }

  // ENTITY (owner) ↔ PERSON (result): the strict path.
  if (ownerKind === "entity" && resultKind === "person") {
    const directors = Array.isArray(opts.knownDirectors) ? opts.knownDirectors : [];
    const coOwners = Array.isArray(opts.coOwnerNames) ? opts.coOwnerNames : [];

    if (directors.some((d) => exactFullNameMatch(d, head))) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "exact_director", reason: "exact_director_match",
        ownerKind, resultKind,
      };
    }
    if (coOwners.some((c) => exactFullNameMatch(c, head))) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "exact_co_owner", reason: "exact_co_owner_match",
        ownerKind, resultKind,
      };
    }

    const haystack = `${resultTitle} ${opts.snippet || ""}`;
    if (entityNameMentioned(ownerName, haystack)) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "person_with_entity_context",
        reason: "entity_name_mentioned_alongside_person",
        ownerKind, resultKind,
      };
    }

    if (opts.isOfficialOwnerSite) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "person_on_owner_site",
        reason: "result_on_official_owner_site",
        ownerKind, resultKind,
      };
    }

    // Last-name-only / generic-vocabulary overlap → weak.
    const overlap = distinctTokenOverlap(ownerName, head);
    const reasonLabel = overlap.length
      ? `weak_person_last_name_match:${overlap.join(",")}`
      : "no_overlap";
    return {
      nameMatch: false,
      weakNameMatch: overlap.length >= 1,
      matchType: overlap.length ? "weak_person_last_name_match" : "no_overlap",
      reason: reasonLabel,
      ownerKind, resultKind,
    };
  }

  // PERSON (owner) ↔ PERSON (result).
  if (ownerKind === "person" && resultKind === "person") {
    if (exactFullNameMatch(ownerName, head)) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "exact_person", reason: "exact_full_name",
        ownerKind, resultKind,
      };
    }
    const overlap = distinctTokenOverlap(ownerName, head);
    if (overlap.length >= 2) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "person_token_overlap",
        reason: `person_overlap:${overlap.join(",")}`,
        ownerKind, resultKind,
      };
    }
    return {
      nameMatch: false,
      weakNameMatch: overlap.length === 1,
      matchType: overlap.length === 1 ? "weak_person_last_name_match" : "no_overlap",
      reason: overlap.length === 1
        ? `weak_person_last_name_match:${overlap[0]}`
        : "no_overlap",
      ownerKind, resultKind,
    };
  }

  // PERSON (owner) ↔ ENTITY (result): only count if the entity name
  // contains the owner's full name (≥ 2 distinct tokens overlap).
  if (ownerKind === "person" && resultKind === "entity") {
    const overlap = distinctTokenOverlap(ownerName, resultTitle);
    if (overlap.length >= 2) {
      return {
        nameMatch: true, weakNameMatch: false,
        matchType: "person_inside_entity",
        reason: `person_in_entity:${overlap.join(",")}`,
        ownerKind, resultKind,
      };
    }
    return {
      nameMatch: false, weakNameMatch: false,
      matchType: "person_to_entity_default", reason: "person_to_entity_no_strong_match",
      ownerKind, resultKind,
    };
  }

  return empty("unreachable", "unreachable_branch");
}

// Minor convenience for backwards-compatible boolean callers.
export function isStrongMatch(evalResult) {
  return !!evalResult?.nameMatch;
}
