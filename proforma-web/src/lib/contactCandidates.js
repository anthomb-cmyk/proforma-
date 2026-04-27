// proforma-web/src/lib/contactCandidates.js
//
// Multi-candidate contact extraction + merge.
//
// The CRM imports leads from messy Excel/CSV exports where phones, emails, and
// websites can live in many columns at once: dedicated "Téléphone" columns,
// owner contact rows, building front-desk lines, free-form notes. Online
// enrichment (Google Places, Pages Jaunes, 411.ca) adds even more candidates
// per lead.
//
// This module is the single source of truth for:
//   1. Pulling every valid phone / email / website out of a raw row, tagging
//      each with the source column it came from + which side of the row
//      (owner vs. building vs. notes vs. contact).
//   2. The canonical "candidate" shape — a record describing one phone/email/
//      website with full provenance: source, source_column, owner_name,
//      relationship_to_lead_owner, confidence, evidence, status.
//   3. Merging candidate lists from multiple sources without ever discarding
//      a file-sourced candidate when an online one shows up later.
//
// Shape of a phone candidate:
//   {
//     phone:                          "(514) 555-0142",        // formatted display
//     source:                         "file" | "cache" | "web_search" |
//                                     "company_website" | "related_company" |
//                                     "directory" | "google_places" | "manual",
//     source_column:                  "Téléphone Propriétaire 2"  (only for file)
//     phone_owner_name:               "Jean Tremblay" | ""
//     relationship_to_lead_owner:     "owner" | "building" | "contact" |
//                                     "notes" | "unknown",
//     confidence:                     0..100
//     evidence:                       human-readable string
//     status:                         "unverified" | "verified" | "invalid"
//   }
//
// Email/website candidates have the same fields with phone → email/website,
// phone_owner_name → email_owner_name / website_owner_name.

import {
  normalizePhoneKey,
  formatPhone,
  extractPhonesFromText,
  mergePhoneLists,
  normalizeTextKey,
} from "./phoneUtils.js";

// ─── Email helpers ─────────────────────────────────────────────────────────

// Reasonably permissive email regex for free-text extraction. We deliberately
// don't try to encode the full RFC 5322 rules — the goal is to pluck obvious
// addresses out of CSV cells and reject obvious garbage. The `+` in local
// parts (jane+work@example.com) is allowed; control chars are not.
const EMAIL_REGEX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

export function normalizeEmailKey(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  // Strip common surrounding punctuation that survives a regex split
  // ("info@x.com," / "<info@x.com>" / "(info@x.com)").
  const cleaned = s.replace(/^[<("'\s]+|[>)"'.,;\s]+$/g, "");
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(cleaned)) return "";
  return cleaned;
}

export function extractEmailsFromText(value) {
  const txt = String(value ?? "");
  if (!txt) return [];
  const seen = new Set();
  const out = [];
  const matches = txt.match(EMAIL_REGEX) || [];
  for (const raw of matches) {
    const key = normalizeEmailKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function mergeEmailLists(...sources) {
  const seen = new Set();
  const out = [];
  const push = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) { value.forEach(push); return; }
    const txt = String(value ?? "");
    if (!txt) return;
    for (const candidate of extractEmailsFromText(txt)) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  };
  sources.forEach(push);
  return out;
}

// ─── Website helpers ───────────────────────────────────────────────────────

// Match either a fully-qualified http(s):// URL or a bare domain.
//   - protocol prefix is captured then stripped
//   - trailing punctuation (".", ",", ")", ";") is trimmed by the post-pass
const URL_REGEX = /(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)+(?:\/[^\s)]*)?/gi;

// File extensions and common domains that should never be treated as websites.
// (Pure domains like "icloud.com" appearing in an email column would otherwise
// pollute the website list.)
const NON_WEBSITE_RE = /\.(jpg|jpeg|png|gif|webp|pdf|docx?|xlsx?|csv|json|xml|svg|bmp|mp4|mov|zip)(?:[/?#]|$)/i;

export function normalizeWebsiteKey(value) {
  let s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  // Reject things that look like emails or files.
  if (s.includes("@")) return "";
  if (NON_WEBSITE_RE.test(s)) return "";
  // Strip protocol + www + trailing slashes / punctuation.
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.replace(/[/.,;)>\]'"\s]+$/, "");
  // Must contain a dot and at least one letter in the TLD.
  if (!/^[a-z0-9](?:[a-z0-9\-.]*[a-z0-9])?\.[a-z]{2,}(?:\/.*)?$/.test(s)) return "";
  return s;
}

export function extractWebsitesFromText(value) {
  const txt = String(value ?? "");
  if (!txt) return [];
  const seen = new Set();
  const out = [];
  // Strip emails first so their domains don't bleed through as websites.
  const noEmail = txt.replace(EMAIL_REGEX, " ");
  const matches = noEmail.match(URL_REGEX) || [];
  for (const raw of matches) {
    const key = normalizeWebsiteKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function mergeWebsiteLists(...sources) {
  const seen = new Set();
  const out = [];
  const push = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) { value.forEach(push); return; }
    for (const candidate of extractWebsitesFromText(String(value))) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  };
  sources.forEach(push);
  return out;
}

// ─── Column classification ─────────────────────────────────────────────────

// Decide whether a header refers to phones, emails, websites, contact names,
// or notes — and which side of the row it belongs to (owner vs. building vs.
// contact vs. notes). Returns { kind, relationship } where:
//   kind         — "phone" | "email" | "website" | "contact" | "notes" | ""
//   relationship — "owner" | "building" | "contact" | "notes" | "unknown"
//
// "unknown" means we identified the kind (e.g. it's a phone column) but the
// header didn't clearly say whether it belongs to the owner or the building.
// Callers treat that as a generic file candidate with no structural hint.
const PHONE_HINT_RE = /\b(phone|telephone|tel|mobile|cell|fax|numero|number)\b/;
const EMAIL_HINT_RE = /\b(email|courriel|mail|e mail)\b/;
const WEBSITE_HINT_RE = /\b(website|web site|site web|site internet|url|web)\b/;
const NOTES_HINT_RE = /\b(notes?|note|comment|comments|remarque|remarques|description)\b/;
const CONTACT_HINT_RE = /\b(contact|nom complet|prenom|first name|last name|full name)\b/;
const OWNER_HINT_RE = /\b(proprietaire|propriete|owner|prop)\b/;
const BUILDING_HINT_RE = /\b(immeuble|building|bldg|batiment|edifice|front desk|super(?:intendant)?)\b/;
const ADDRESS_HINT_RE = /\b(address|adresse|postal|zip|city|ville|province|state|suite|apt|unit|street|rue)\b/;

export function classifyContactColumn(headerName) {
  const norm = normalizeTextKey(headerName);
  if (!norm) return { kind: "", relationship: "unknown" };

  // Address / city / postal columns sometimes carry phones-in-text by accident
  // ("123 Main, 514-555-1234"). We classify them as "" so the caller does NOT
  // treat the column as a primary phone column. A separate full-row scan still
  // picks up those phones with relationship = "unknown".
  if (ADDRESS_HINT_RE.test(norm) && !PHONE_HINT_RE.test(norm) && !EMAIL_HINT_RE.test(norm)) {
    return { kind: "", relationship: "unknown" };
  }

  let kind = "";
  if (PHONE_HINT_RE.test(norm)) kind = "phone";
  else if (EMAIL_HINT_RE.test(norm)) kind = "email";
  else if (WEBSITE_HINT_RE.test(norm)) kind = "website";
  else if (NOTES_HINT_RE.test(norm)) kind = "notes";
  else if (CONTACT_HINT_RE.test(norm)) kind = "contact";

  let relationship = "unknown";
  if (kind === "notes") relationship = "notes";
  else if (kind === "contact") relationship = "contact";
  else if (BUILDING_HINT_RE.test(norm)) relationship = "building";
  else if (OWNER_HINT_RE.test(norm)) relationship = "owner";

  return { kind, relationship };
}

// ─── Candidate construction ────────────────────────────────────────────────

// Default confidence per source. File candidates start high because they came
// directly from the user's source data; online candidates start lower because
// they're inferred matches that the user may want to review.
const SOURCE_CONFIDENCE = {
  file: 85,
  manual: 95,
  cache: 75,
  web_search: 60,
  company_website: 70,
  related_company: 55,
  directory: 65,
  google_places: 70,
};

export const VALID_SOURCES = new Set([
  "file", "cache", "web_search", "company_website",
  "related_company", "directory", "google_places", "manual",
]);

function defaultConfidence(source) {
  return Object.prototype.hasOwnProperty.call(SOURCE_CONFIDENCE, source)
    ? SOURCE_CONFIDENCE[source]
    : 50;
}

// Build a phone candidate. `phone` should already be a NANP-valid string
// (caller is expected to have validated via normalizePhoneKey first).
export function makePhoneCandidate({
  phone,
  source,
  source_column = "",
  phone_owner_name = "",
  relationship_to_lead_owner = "unknown",
  confidence,
  evidence = "",
  status = "unverified",
} = {}) {
  if (!phone) return null;
  const formatted = formatPhone(phone);
  if (!normalizePhoneKey(formatted)) return null;
  const src = VALID_SOURCES.has(source) ? source : "file";
  return {
    phone: formatted,
    source: src,
    source_column: source_column || "",
    phone_owner_name: String(phone_owner_name || ""),
    relationship_to_lead_owner: relationship_to_lead_owner || "unknown",
    confidence: Number.isFinite(confidence) ? Number(confidence) : defaultConfidence(src),
    evidence: String(evidence || ""),
    status: status || "unverified",
  };
}

export function makeEmailCandidate({
  email,
  source,
  source_column = "",
  email_owner_name = "",
  relationship_to_lead_owner = "unknown",
  confidence,
  evidence = "",
  status = "unverified",
} = {}) {
  const key = normalizeEmailKey(email);
  if (!key) return null;
  const src = VALID_SOURCES.has(source) ? source : "file";
  return {
    email: key,
    source: src,
    source_column: source_column || "",
    email_owner_name: String(email_owner_name || ""),
    relationship_to_lead_owner: relationship_to_lead_owner || "unknown",
    confidence: Number.isFinite(confidence) ? Number(confidence) : defaultConfidence(src),
    evidence: String(evidence || ""),
    status: status || "unverified",
  };
}

export function makeWebsiteCandidate({
  website,
  source,
  source_column = "",
  website_owner_name = "",
  relationship_to_lead_owner = "unknown",
  confidence,
  evidence = "",
  status = "unverified",
} = {}) {
  const key = normalizeWebsiteKey(website);
  if (!key) return null;
  const src = VALID_SOURCES.has(source) ? source : "file";
  return {
    website: key,
    source: src,
    source_column: source_column || "",
    website_owner_name: String(website_owner_name || ""),
    relationship_to_lead_owner: relationship_to_lead_owner || "unknown",
    confidence: Number.isFinite(confidence) ? Number(confidence) : defaultConfidence(src),
    evidence: String(evidence || ""),
    status: status || "unverified",
  };
}

// ─── Per-row extraction ────────────────────────────────────────────────────

// Pull every contact candidate out of a raw Excel/CSV row. Iterates each
// column once, using classifyContactColumn() to decide what to look for and
// how to tag the resulting candidate.
//
// Returns:
//   {
//     candidatePhones:    [phoneCandidate, ...],
//     candidateEmails:    [emailCandidate, ...],
//     candidateWebsites:  [websiteCandidate, ...],
//   }
//
// Behavior notes:
//   - Multiple values in a single cell ("514-555-0123 / 514-555-9999") are
//     all extracted, all tagged with the same source_column.
//   - A column classified as "notes" is scanned for ALL three kinds (phone,
//     email, website) since notes can carry anything.
//   - A column classified as "contact" is also scanned, primarily because
//     "Contact: Jean (514-555-0123)" is a common rôle-export shape.
//   - Address / city / postal columns are skipped — phones in address strings
//     are usually street numbers concatenated with civic data and almost
//     always misleading. Caller can re-scan them via mergePhoneLists if needed.
//   - Source defaults to "file" since this function only runs at file-import
//     time. Pass `options.source` to override (used by tests).
export function extractContactCandidatesFromRow(rawRow, options = {}) {
  const out = { candidatePhones: [], candidateEmails: [], candidateWebsites: [] };
  if (!rawRow || typeof rawRow !== "object") return out;
  const source = options.source || "file";
  const ownerName = String(options.ownerName || "").trim();

  const phoneSeen = new Set(); // key: normPhone|source|source_column
  const emailSeen = new Set();
  const websiteSeen = new Set();

  const pushPhone = (cand) => {
    if (!cand) return;
    const k = `${normalizePhoneKey(cand.phone)}|${cand.source}|${cand.source_column}`;
    if (phoneSeen.has(k)) return;
    phoneSeen.add(k);
    out.candidatePhones.push(cand);
  };
  const pushEmail = (cand) => {
    if (!cand) return;
    const k = `${cand.email}|${cand.source}|${cand.source_column}`;
    if (emailSeen.has(k)) return;
    emailSeen.add(k);
    out.candidateEmails.push(cand);
  };
  const pushWebsite = (cand) => {
    if (!cand) return;
    const k = `${cand.website}|${cand.source}|${cand.source_column}`;
    if (websiteSeen.has(k)) return;
    websiteSeen.add(k);
    out.candidateWebsites.push(cand);
  };

  for (const [headerRaw, value] of Object.entries(rawRow)) {
    if (value === null || value === undefined) continue;
    const cellText = String(value);
    if (!cellText.trim()) continue;
    const { kind, relationship } = classifyContactColumn(headerRaw);
    const evidenceBase = `column "${headerRaw}"`;

    // Phones: from explicit phone columns AND from notes / contact columns.
    if (kind === "phone" || kind === "notes" || kind === "contact") {
      const phones = extractPhonesFromText(cellText);
      for (const p of phones) {
        pushPhone(makePhoneCandidate({
          phone: p,
          source,
          source_column: headerRaw,
          phone_owner_name: ownerName,
          relationship_to_lead_owner: relationship,
          evidence: evidenceBase,
        }));
      }
    }

    // Emails: from explicit email columns AND from notes / contact columns.
    if (kind === "email" || kind === "notes" || kind === "contact") {
      const emails = extractEmailsFromText(cellText);
      for (const e of emails) {
        pushEmail(makeEmailCandidate({
          email: e,
          source,
          source_column: headerRaw,
          email_owner_name: ownerName,
          relationship_to_lead_owner: relationship,
          evidence: evidenceBase,
        }));
      }
    }

    // Websites: from explicit website columns AND from notes columns.
    if (kind === "website" || kind === "notes") {
      const sites = extractWebsitesFromText(cellText);
      for (const w of sites) {
        pushWebsite(makeWebsiteCandidate({
          website: w,
          source,
          source_column: headerRaw,
          website_owner_name: ownerName,
          relationship_to_lead_owner: relationship,
          evidence: evidenceBase,
        }));
      }
    }
  }

  return out;
}

// ─── Candidate merging ─────────────────────────────────────────────────────

// Merge multiple candidate lists, deduping by (normalized value × source ×
// source_column). When the same (value, source, source_column) tuple appears
// more than once, the FIRST occurrence wins (callers should pass the higher-
// priority list first — typically file candidates come before online ones).
//
// Per spec: dedupe by normalized value but PRESERVE all source/evidence
// references. We satisfy that by keeping every distinct (source, source_column)
// reference as its own candidate entry. The flat phones[]/emails[]/websites[]
// arrays produced by `flattenCandidates` give the dedup'd-by-value view.

function mergeCandidates(lists, keyOf) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const cand of list) {
      if (!cand) continue;
      const k = keyOf(cand);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(cand);
    }
  }
  return out;
}

export function mergePhoneCandidates(...lists) {
  return mergeCandidates(
    lists,
    (c) => `${normalizePhoneKey(c.phone)}|${c.source}|${c.source_column || ""}`,
  );
}

export function mergeEmailCandidates(...lists) {
  return mergeCandidates(
    lists,
    (c) => `${normalizeEmailKey(c.email)}|${c.source}|${c.source_column || ""}`,
  );
}

export function mergeWebsiteCandidates(...lists) {
  return mergeCandidates(
    lists,
    (c) => `${normalizeWebsiteKey(c.website)}|${c.source}|${c.source_column || ""}`,
  );
}

// Flatten a candidate list into a deduped value-only array, preserving the
// order of the highest-confidence occurrence per normalized value. Used to
// populate Lead.phones[] / Lead.emails[] / Lead.websites[] from candidate
// arrays — these are the values the UI reads to display contacts.
function flattenCandidates(candidates, normalizer, valueField) {
  const map = new Map();
  for (const c of (candidates || [])) {
    if (!c) continue;
    const value = c[valueField];
    if (!value) continue;
    const key = normalizer(value);
    if (!key) continue;
    const conf = Number(c.confidence) || 0;
    const existing = map.get(key);
    if (!existing || conf > existing.confidence) {
      map.set(key, { value, confidence: conf });
    }
  }
  return Array.from(map.values()).map((entry) => entry.value);
}

export function flattenPhoneCandidates(candidates) {
  return flattenCandidates(candidates, normalizePhoneKey, "phone");
}

export function flattenEmailCandidates(candidates) {
  return flattenCandidates(candidates, normalizeEmailKey, "email");
}

export function flattenWebsiteCandidates(candidates) {
  return flattenCandidates(candidates, normalizeWebsiteKey, "website");
}

// Pick the "best" candidate value for the legacy primary-field slot
// (lead.phone / lead.email / lead.website). Priority:
//   1. Highest-confidence file candidate (user's own source data is canonical).
//   2. Highest-confidence non-file candidate (online enrichment).
//   3. "" if nothing is available.
//
// Within a tier, ties broken by first-occurrence (stable).
function pickBestValue(candidates, valueField) {
  if (!Array.isArray(candidates) || !candidates.length) return "";
  const fileTier = candidates.filter((c) => c?.source === "file" || c?.source === "manual");
  const onlineTier = candidates.filter((c) => c && c.source !== "file" && c.source !== "manual");
  const pickFromTier = (tier) => {
    if (!tier.length) return "";
    let best = tier[0];
    for (const c of tier) {
      if (Number(c.confidence) > Number(best.confidence)) best = c;
    }
    return best?.[valueField] || "";
  };
  return pickFromTier(fileTier) || pickFromTier(onlineTier);
}

export function pickBestPhone(candidates) { return pickBestValue(candidates, "phone"); }
export function pickBestEmail(candidates) { return pickBestValue(candidates, "email"); }
export function pickBestWebsite(candidates) { return pickBestValue(candidates, "website"); }

// Convenience: build candidates from already-extracted online-lookup output
// (e.g. a phoneEnrichment result). Each phone in `phones` becomes a candidate
// with source = `source` (default "google_places") and shared evidence.
export function candidatesFromOnlinePhones(phones, {
  source = "google_places",
  evidence = "",
  phone_owner_name = "",
  confidence,
  status = "unverified",
} = {}) {
  return mergePhoneLists(phones).map((p) => makePhoneCandidate({
    phone: p,
    source,
    phone_owner_name,
    relationship_to_lead_owner: "owner",
    confidence,
    evidence,
    status,
  })).filter(Boolean);
}

export function candidatesFromOnlineEmails(emails, {
  source = "web_search",
  evidence = "",
  email_owner_name = "",
  confidence,
  status = "unverified",
} = {}) {
  return mergeEmailLists(emails).map((e) => makeEmailCandidate({
    email: e,
    source,
    email_owner_name,
    relationship_to_lead_owner: "owner",
    confidence,
    evidence,
    status,
  })).filter(Boolean);
}

export function candidatesFromOnlineWebsites(websites, {
  source = "google_places",
  evidence = "",
  website_owner_name = "",
  confidence,
  status = "unverified",
} = {}) {
  return mergeWebsiteLists(websites).map((w) => makeWebsiteCandidate({
    website: w,
    source,
    website_owner_name,
    relationship_to_lead_owner: "owner",
    confidence,
    evidence,
    status,
  })).filter(Boolean);
}
