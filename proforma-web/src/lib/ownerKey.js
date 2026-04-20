// proforma-web/src/lib/ownerKey.js
//
// Canonical owner identity for Quebec property rolls.
//
// Problem: the same investor shows up as dozens of "different" legal owners —
// numbered companies (9338-8387 QUEBEC INC., 9440-5222 QUEBEC INC.), family
// trusts, spouses, the person's own name — one per holding entity. Grouping
// by the Propriétaire *name* gives you dupes. Grouping by the Propriétaire's
// *mailing address* correctly unifies all of them, because one physical
// person operates out of one physical address regardless of how many shell
// companies they file taxes under.
//
// Key rule: ownerKey = normalize(street address) + strip(postal code)
//   "9338-8387 QUEBEC INC."     @ "217 Saint-Jacques"     H2Y 1M6
//   "9440-5222 QUEBEC INC."     @ "217 rue Saint-Jacques" H2Y1M6
//   "Fiducie Famille Tremblay"  @ "217 St-Jacques"        H2Y 1M6
//         → all collapse to   "217 saint jacques|h2y1m6"
//
// What normalization strips:
//   • Diacritics          (é→e, à→a, ç→c, …)
//   • Abbreviations       (Ste-/Ste → sainte, St-/St → saint)
//   • Street-type words   (rue, avenue, boulevard, chemin, place, …)
//   • Unit/apt suffixes   (app. 3, apt 5, suite 204, #12, bureau 4)
//   • Punctuation + case
//   • Redundant whitespace
//
// Why separate street + postal rather than "address blob": postal code gives us
// disambiguation when two different streets in different cities happen to
// normalize the same way (rare but real). Street + postal ≈ geospatial uniqueness.
//
// A returned key of "" means "not enough info to group" — caller should fall
// back to the row's civic address so we don't merge two unrelated unknowns.

// Street-type words in QC/ON data. Keep lowercase; match as whole words.
// Include both French (rue, avenue, boulevard, chemin, place, …) and their
// abbreviations, plus common English ones imported from anglo municipalities.
//
// Deliberately EXCLUDED: "cote"/"côte" and "montee"/"montée". These are street
// NAMES in Quebec ("Côte-Vertu", "Montée du Moulin"), not types — stripping
// them would mangle real addresses. Same reason we keep "saint"/"sainte" — they
// look like prefixes but they're part of the proper name of the street.
const STREET_TYPES = new Set([
  "rue", "r",
  "avenue", "av", "ave",
  "boulevard", "boul", "blvd", "bld",
  "chemin", "ch",
  "place", "pl",
  "croissant", "crois", "crt",
  "impasse",
  "allee", "allée",
  "ruelle",
  "route", "rte",
  "terrasse", "terr",
  "street", "st", "str",
  "road", "rd",
  "drive", "dr",
  "lane", "ln",
  "court", "ct",
  "way",
]);

// Unit/apt markers — we drop the marker AND the adjacent number token.
// Quebec rolls often suffix with "app. 3", "apt 5", "suite 204", "bureau 4",
// "# 12". These vary by building/row for the same mailing address and would
// otherwise split one owner into many.
//
// Two regexes because "#" has no word boundary to anchor against.
// Deliberately NOT matching "ste" here — Saint/Sainte expansion runs first
// and "Ste-Catherine" must not be treated as a unit marker.
const WORD_UNIT_MARKERS = /\b(app(?:artement|t)?\.?|apt\.?|suite|bureau|unite|unité|unit)\s*[a-z]?-?\d+\w*/gi;
const HASH_UNIT_MARKERS = /#\s*\d+\w*/g;

// Strip every diacritic by decomposing to NFD and dropping combining marks.
// This is the single canonical rule — do not mix with hand-maintained tables.
function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Expand Saint/Sainte abbreviations BEFORE stripping punctuation so that
// "Ste-Catherine" / "Ste Catherine" / "Ste.Catherine" all collapse to
// "sainte catherine". Do this on an accent-stripped copy so "Ste-Thérèse"
// becomes "sainte therese" regardless of how the accent was typed.
//
// Core rule: expand ONLY when clearly a saint-name prefix. That means:
//   1. "St-" / "Ste-" / "St." / "Ste." followed (optionally via whitespace)
//      by a word character — "St-Jacques", "Ste. Catherine".
//   2. "St "/"Ste " followed by a CAPITAL letter — "St Laurent".
// Trailing "Main St." with no word after gets left alone so it can be
// stripped by the street-type pass as the English abbreviation for "Street".
function expandSaint(s) {
  return s
    .replace(/\bste[-.](?=\s*\w)/gi, "Sainte ")
    .replace(/\bst[-.](?=\s*\w)/gi, "Saint ")
    .replace(/\bSte\s+(?=[A-Z])/g, "Sainte ")
    .replace(/\bSt\s+(?=[A-Z])/g, "Saint ");
}

// Drop unit/apt/suite tokens (and their numbers) so "217 rue St-Jacques app. 3"
// groups with "217 rue St-Jacques" — the office is the same even if the billing
// row lists a different desk number.
function stripUnits(s) {
  return s.replace(WORD_UNIT_MARKERS, " ").replace(HASH_UNIT_MARKERS, " ");
}

// Strip all punctuation to spaces (NOT delete — "217-Saint" should keep the
// boundary between 217 and Saint). Collapse runs of whitespace afterwards.
function stripPunctuation(s) {
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function collapseWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

// Token-level filter: drop any token that matches a street-type word. We do
// this AFTER accent-stripping + lowercasing + Saint expansion so "av." / "Av"
// / "avenue" all collapse first.
function dropStreetTypes(s) {
  return s
    .split(" ")
    .filter(tok => tok && !STREET_TYPES.has(tok))
    .join(" ");
}

// Public: normalize a street address for owner-grouping purposes. Idempotent
// (normalizeStreet(normalizeStreet(x)) === normalizeStreet(x)). Returns "" on
// empty/whitespace-only input so the caller can tell "no key" apart from a
// real normalization.
export function normalizeStreet(raw) {
  if (raw == null) return "";
  let s = String(raw);
  if (!s.trim()) return "";
  s = stripAccents(s);
  s = expandSaint(s);
  s = s.toLowerCase();
  s = stripUnits(s);
  s = stripPunctuation(s);
  s = collapseWs(s);
  s = dropStreetTypes(s);
  s = collapseWs(s);
  return s;
}

// Normalize a Canadian postal code: drop spaces, lowercase, validate shape.
// A1A 1A1 → "a1a1a1". Invalid → "" (caller treats as "no postal disambiguator").
export function normalizePostal(raw) {
  if (!raw) return "";
  const compact = String(raw).replace(/\s+/g, "").toLowerCase();
  // Canadian FSA+LDU: letter-digit-letter digit-letter-digit.
  if (!/^[a-z]\d[a-z]\d[a-z]\d$/.test(compact)) return "";
  return compact;
}

// Build the grouping key. Returns "" when we can't form a usable one (empty
// address AND empty postal → no anchor). If only one of the two is present,
// we still build a key — postal alone is weak but non-empty postal at least
// lets rural rows without street addresses group by rural route number
// elsewhere, and street alone covers the common case of typo'd postal codes.
export function ownerKey(rawAddress, rawPostal) {
  const street = normalizeStreet(rawAddress);
  const postal = normalizePostal(rawPostal);
  if (!street && !postal) return "";
  // Use "|" as separator (no street contains |) so key parsing stays simple.
  return `${street}|${postal}`;
}

// For callers that want a human-legible label from a key (debug tooltips).
export function describeOwnerKey(key) {
  if (!key || typeof key !== "string") return "";
  const [street, postal] = key.split("|");
  if (street && postal) return `${street} (${postal.toUpperCase()})`;
  return street || postal.toUpperCase() || "";
}
