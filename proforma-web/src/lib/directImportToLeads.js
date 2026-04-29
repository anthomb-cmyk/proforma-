// proforma-web/src/lib/directImportToLeads.js
//
// Pure helper: convert rows that already carry a valid NANP phone into
// export-ready lead records for the existing onExportFoundToLeads pipeline.
// No API calls. No side effects. Testable in isolation.

import { normalizePhoneKey, isValidNanpPhone, pickPhoneFromValueWithContext } from "./phoneUtils.js";

// ── Phone validation ──────────────────────────────────────────────────────
// Client-side inline check so this module has no server-side dependencies.
// isValidNanpPhone is already exported from phoneUtils.js (same logic as
// services/phoneEnrichment.js — kept in lock-step via parity test).

/**
 * Given a raw phone string, return the 10-digit normalized form if it is a
 * valid NANP subscriber number, or null otherwise.
 */
export function normalizeValidPhone(raw) {
  const key = normalizePhoneKey(raw);
  return key && isValidNanpPhone(key) ? key : null;
}

function normalizeHeaderName(key) {
  return String(key || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function rowEntries(row) {
  if (!row || typeof row !== "object") return [];
  const source = row.rawRow && typeof row.rawRow === "object" ? row.rawRow : row;
  return Object.entries(source)
    .map(([key, value]) => ({ key, norm: normalizeHeaderName(key), value: cleanCell(value) }))
    .filter((entry) => entry.value);
}

function pickFirstByHeader(row, patterns, { reject = [] } = {}) {
  for (const pattern of patterns) {
    for (const entry of rowEntries(row)) {
      if (!pattern.test(entry.norm)) continue;
      if (reject.some((rx) => rx.test(entry.norm))) continue;
      return entry.value;
    }
  }
  return "";
}

function inferOwnerName(row) {
  return cleanCell(row?.leadContact)
    || cleanCell(row?.lead_owner_name)
    || cleanCell(row?.ownerName)
    || cleanCell(row?.companyName)
    || cleanCell(row?.name)
    || cleanCell(row?.rawName)
    || pickFirstByHeader(row, [
      /\bproprietaire\d*\s+nom\b/,
      /\bowner\s+name\b/,
      /\bnom\s+proprio\b/,
      /\bproprietaire\d*\b/,
      /\bowner\b/,
    ], {
      reject: [/\badresse\b/, /\baddress\b/, /\bstatut\b/, /\bstatus\b/, /\btelephone\b/, /\bphone\b/, /\bcourriel\b/, /\bemail\b/],
    });
}

function inferBuildingAddress(row) {
  return cleanCell(row?.buildingAddress)
    || cleanCell(row?.inputAddress)
    || cleanCell(row?.matchedAddress)
    || cleanCell(row?.address)
    || pickFirstByHeader(row, [
      /\badresses?\s+immeubles?\s+clean\b/,
      /\badresse\s+immeuble\b/,
      /\badresses?\s+immeubles?\b/,
      /\bbuilding\s+address\b/,
      /\badresse\b/,
      /\baddress\b/,
    ], {
      reject: [/\bpostale\b/, /\bpostal\b/, /\bproprietaire\b/, /\bowner\b/],
    });
}

function inferCity(row) {
  return cleanCell(row?.city)
    || pickFirstByHeader(row, [
      /\bville\s+immeuble\b/,
      /\bville\d*\b/,
      /\bcity\b/,
      /\bmunicipalite\b/,
    ], {
      reject: [/\bpostale\b/, /\bpostal\b/, /\bproprietaire\b/, /\bowner\b/],
    });
}

function inferProvince(row) {
  return cleanCell(row?.province)
    || pickFirstByHeader(row, [/\bprovince\b/, /\betat\b/, /\bstate\b/])
    || "QC";
}

function inferPostalCode(row) {
  return cleanCell(row?.postalCode)
    || cleanCell(row?.postal_code)
    || pickFirstByHeader(row, [
      /\bcode\s+postal\s+immeuble\b/,
      /\bcode\s+postal\b/,
      /\bpostal\s+code\b/,
      /\bzip\b/,
    ], {
      reject: [/\bpostale\b/, /\bproprietaire\b/, /\bowner\b/],
    });
}

/**
 * Pick the best (first valid NANP) phone from a row. Inspects `inputPhones`
 * (the pre-merged phone list populated by PhoneFinder) first; falls back to
 * scanning the raw phone column strings on the original row object.
 *
 * Returns the 10-digit normalized string or null.
 */
export function pickBestPhone(row) {
  if (!row || typeof row !== "object") return null;

  // 1. Already-merged inputPhones array (most reliable).
  if (Array.isArray(row.inputPhones)) {
    for (const p of row.inputPhones) {
      const n = normalizeValidPhone(p);
      if (n) return n;
    }
  }

  // 2. Explicit phone field on the row.
  if (row.phone) {
    const n = normalizeValidPhone(row.phone);
    if (n) return n;
  }

  // 3. Walk the rawRow COLUMNS — but ONLY columns whose name hints at "phone"
  // content. Walking every column blindly causes false positives where long
  // identifiers (matricules, cadastre numbers, lot codes) get sliced to 10
  // digits and incorrectly accepted as NANP phones.
  const raw = row.rawRow || row;
  const PHONE_COL_RE = /\b(?:tel|phone|telephone|t[e\u00e9]l[e\u00e9]phone|mobile|cell|fax|numero|number|\bno[\s_-]+t[e\u00e9]l\b)\b/i;
  for (const [key, val] of Object.entries(raw)) {
    if (!PHONE_COL_RE.test(String(key))) continue;
    if (typeof val !== "string" && typeof val !== "number") continue;
    const n = pickPhoneFromValueWithContext(val);
    if (n) return n;
  }

  // 4. Last-resort: walk ALL columns but with strict per-value validation.
  // Only accept values whose original digit count matches a phone shape
  // (10 digits exact, or 11 starting with 1). This catches phones in unmapped
  // columns without producing matricule false-positives.
  for (const [key, val] of Object.entries(raw)) {
    if (PHONE_COL_RE.test(String(key))) continue; // already tried above
    if (typeof val !== "string" && typeof val !== "number") continue;
    const n = pickPhoneFromValueWithContext(val);
    if (n) return n;
  }

  return null;
}

/**
 * Classify a row as "likely residential / insufficient data" — has a phone
 * but lacks both a recognisable owner/company name AND a building address.
 */
export function isLikelyResidentialOrInsufficient(row) {
  if (!row || typeof row !== "object") return true;
  const name = inferOwnerName(row);
  const addr = inferBuildingAddress(row);
  return !name && !addr;
}

/**
 * Convert rows that already have a valid phone into export-ready lead records
 * shaped for the existing onExportFoundToLeads pipeline. No API calls.
 *
 * Rows without any valid NANP phone land in `skipped`.
 * Rows classified as residential/insufficient are included in `leadsToExport`
 * with `likelyResidential: true`.
 *
 * @param {object[]} rows  PhoneFinder import rows (rawRow / inputPhones shape).
 * @returns {{ leadsToExport: object[], skipped: object[] }}
 */
export function buildDirectImportToLeads(rows) {
  if (!Array.isArray(rows)) return { leadsToExport: [], skipped: [] };

  const leadsToExport = [];
  const skipped = [];

  for (const row of rows) {
    const phone = pickBestPhone(row);
    if (!phone) {
      skipped.push(row);
      continue;
    }

    const ownerName = inferOwnerName(row) || "(unknown)";
    const companyName = cleanCell(row?.companyName) || cleanCell(row?.company) || ownerName;
    const leadContact = cleanCell(row?.leadContact) || ownerName;

    const address = inferBuildingAddress(row);
    const city = inferCity(row);
    const province = inferProvince(row);
    const postalCode = inferPostalCode(row);

    const residential = isLikelyResidentialOrInsufficient(row);

    leadsToExport.push({
      lead_owner_name: ownerName,
      companyName,
      leadContact,
      inputName: companyName || ownerName,
      matchedName: companyName || ownerName,
      address,
      inputAddress: address,
      matchedAddress: address,
      city,
      province,
      postalCode,
      buildingAddress: address,
      phone,
      bestPhone: phone,
      inputPhones: [phone],
      fileInputPhones: [phone],
      candidatePhones: [
        {
          phone,
          confidence: "high",
          source: "imported_with_phone",
          relationship_to_lead_owner: "owner",
          phone_owner_name: ownerName,
        },
      ],
      status: "ready_to_call",
      source: "file_direct_import",
      likelyResidential: residential,
      rawRow: row.rawRow || row,
      _src: row,
      _directImport: true,
    });
  }

  return { leadsToExport, skipped };
}

/**
 * Count how many rows in an import batch already have a valid NANP phone.
 */
export function countRowsWithPhone(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => pickBestPhone(r) !== null).length;
}
