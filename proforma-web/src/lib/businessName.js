// Heuristics used to decide whether a free-form owner-name string (from an
// Excel column) is worth querying Google Places for as a business, or whether
// it's a personal name / address / garbage and should be skipped.
//
// These live client-side so the UI can disable lookup buttons / show labels
// before a request is sent. The server applies its own junk filter in
// phoneEnrichment.isJunkBusinessName; the two stay in rough agreement but
// are not bit-for-bit identical (the server rules are stricter about Quebec
// cadastre/matricule shapes that only appear in the raw Excel data).

import { normalizeTextKey } from "./phoneUtils.js";

export const COMPANY_NAME_HINT_RE = /\b(?:inc|ltee|ltd|llc|corp|corporation|compagnie|company|co|groupe|group|entreprise|business|service|services|renovation|construction|immobilier|realty|property|properties|holdings|restaurant|cafe|garage|atelier|clinic|clinique|pharmacie|hotel|motel|association|centre|center|studio|consulting|solution|solutions|tech|technologie|technologies|bureau|cabinet|banque|bank|insurance|assurance)\b/;

// Words that connect name tokens in French/English person-name heuristics
// ("Jean de la Fontaine", "Saint-Pierre"), so we don't miscount tokens.
export const PERSON_JOINER_WORDS = new Set(["de", "du", "des", "la", "le", "les", "d", "st", "saint", "sainte", "van", "von"]);

export function looksLikeAddressText(value) {
  const norm = normalizeTextKey(value);
  if (!norm) return false;
  return /\d/.test(norm) && /\b(rue|street|st|avenue|av|boulevard|blvd|road|rd|chemin|route|lane|ln|drive|dr|suite|unit|apt|appartement|immeuble)\b/.test(norm);
}

export function hasCompanyNameHints(value) {
  const norm = normalizeTextKey(value);
  if (!norm) return false;
  return COMPANY_NAME_HINT_RE.test(norm);
}

export function isLikelyPersonalLookupName(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (hasCompanyNameHints(raw) || looksLikeAddressText(raw)) return false;
  if (/[&/@]/.test(raw)) return false;
  const norm = normalizeTextKey(raw);
  if (!norm || /\d/.test(norm)) return false;
  const words = norm.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const meaningful = words.filter((word) => !PERSON_JOINER_WORDS.has(word));
  if (meaningful.length < 2) return false;
  return meaningful.every((word) => word.length >= 2 && word.length <= 24);
}

export function sanitizeBusinessLookupName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (looksLikeAddressText(raw)) return "";
  if (/^[0-9\s().+-]+$/.test(raw)) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return "";
  if (isLikelyPersonalLookupName(raw)) return "";
  return raw;
}

// Returns the first value in `values` that survives sanitizeBusinessLookupName.
// Use this to pick a usable business-name string from a list of fallbacks
// (e.g. [companyName, matchedName, rawName]).
export function firstBusinessLookupName(...values) {
  for (const value of values) {
    const cleaned = sanitizeBusinessLookupName(value);
    if (cleaned) return cleaned;
  }
  return "";
}
