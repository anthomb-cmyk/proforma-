// proforma-web/src/lib/phoneUtils.js
//
// Shared phone normalization + validation utilities for the React client.
//
// ⚠️  THIS FILE MIRRORS services/phoneEnrichment.js (server-side).
//     When you change NANP rules, regex patterns, or merge semantics here,
//     make the same change to phoneEnrichment.js and keep
//     services/phoneEnrichment.test.js green.
//     There is also a parity unit test at services/phoneEnrichment.parity.test.js
//     that pins down a corpus of inputs and diff-checks both implementations.
//
// Why not a single source of truth? CRA does not allow imports outside `src/`
// by default, and the server is ESM-only. Moving the shared file behind CRACO
// or restructuring into a monorepo package was deemed too big a change for the
// current cleanup pass. Keep both files in lock-step via the parity test.

// NANP service codes / fictional ranges that a real subscriber line can never
// use. See ATIS-0300051 for the spec.
const NANP_N11 = new Set(["211", "311", "411", "511", "611", "711", "811", "911"]);
const NANP_RESERVED_NXX = new Set(["000", "999", "958", "959"]);

export function isValidNanpPhone(digits10) {
  if (!/^\d{10}$/.test(digits10)) return false;
  const npa = digits10.slice(0, 3);
  const nxx = digits10.slice(3, 6);
  const sub = digits10.slice(6, 10);
  if (npa[0] < "2") return false;            // area code can't start 0 or 1
  if (NANP_N11.has(npa)) return false;       // N11 codes aren't area codes
  if (nxx[0] < "2") return false;            // exchange can't start 0 or 1
  if (NANP_N11.has(nxx)) return false;       // 211/311/…/911 not an exchange
  if (NANP_RESERVED_NXX.has(nxx)) return false; // 000/999/958/959 reserved
  if (nxx === "555" && !/^01\d\d$/.test(sub)) return false; // 555 fiction
  if (/^(\d)\1{9}$/.test(digits10)) return false;  // all same digit
  if (/(\d)\1{6,}/.test(digits10)) return false;   // 7+ identical in a row
  return true;
}

export function normalizePhoneKey(value) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  let n = digits;
  if (n.length >= 11 && n.startsWith("1")) n = n.slice(1);
  if (n.length > 10) n = n.slice(0, 10);
  if (n.length !== 10) return "";
  if (!isValidNanpPhone(n)) return "";
  return n;
}

export function formatPhone(value) {
  const k = normalizePhoneKey(value);
  if (!k) return String(value ?? "").trim();
  return `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}`;
}

// Extract all NANP-valid phones from free-form text.
// The regex is deliberately permissive; we rely on normalizePhoneKey /
// isValidNanpPhone to reject garbage.
const PHONE_TEXT_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g;
const PHONE_COMPACT_RE = /\b1?\d{10}\b/g;

export function extractPhonesFromText(value) {
  const txt = String(value ?? "");
  const matches = [
    ...(txt.match(PHONE_TEXT_RE) || []),
    ...(txt.match(PHONE_COMPACT_RE) || []),
  ];
  const normalized = [];
  const seen = new Set();
  for (const raw of matches) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    const key = normalizePhoneKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

export function mergePhoneLists(...sources) {
  const merged = [];
  const seen = new Set();
  const pushOne = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) { value.forEach(pushOne); return; }
    const raw = String(value ?? "").trim();
    if (!raw) return;
    const candidates = extractPhonesFromText(raw);
    if (!candidates.length) return;
    candidates.forEach((phone) => {
      const key = normalizePhoneKey(phone);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(phone);
    });
  };
  sources.forEach(pushOne);
  return merged;
}

export function normalizeTextKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function extractPhonesFromRow(row) {
  if (!row || typeof row !== "object") return [];
  const allValues = Object.values(row || {});
  // Prefer explicit phone columns so that the display order reflects user intent.
  const phoneKeyValues = Object.entries(row)
    .filter(([key]) => {
      const norm = normalizeTextKey(key);
      const hasPhoneHint = /\b(phone|telephone|tel|mobile|cell|fax|numero|number)\b/.test(norm);
      const hasAddressHint =
        /\b(address|adresse|postal|zip|city|ville|province|state|suite|apt|unit|immeuble)\b/.test(norm);
      return hasPhoneHint && !hasAddressHint;
    })
    .map(([, value]) => value);
  return mergePhoneLists(phoneKeyValues, allValues);
}
