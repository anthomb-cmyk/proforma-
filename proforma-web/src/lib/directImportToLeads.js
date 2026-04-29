// proforma-web/src/lib/directImportToLeads.js
//
// Pure helper: convert rows that already carry a valid NANP phone into
// export-ready lead records for the existing onExportFoundToLeads pipeline.
// No API calls. No side effects. Testable in isolation.

import { normalizePhoneKey, isValidNanpPhone } from "./phoneUtils.js";

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

  // 3. Walk the rawRow columns as a last-resort fallback.
  const raw = row.rawRow || row;
  for (const val of Object.values(raw)) {
    if (typeof val === "string" || typeof val === "number") {
      const n = normalizeValidPhone(String(val));
      if (n) return n;
    }
  }

  return null;
}

/**
 * Classify a row as "likely residential / insufficient data" — has a phone
 * but lacks both a recognisable business name AND a building address.
 */
export function isLikelyResidentialOrInsufficient(row) {
  if (!row || typeof row !== "object") return true;
  const name =
    String(row.companyName || row.name || row.rawName || row.leadContact || "").trim();
  const addr = String(
    row.buildingAddress || row.address || row.inputAddress || ""
  ).trim();
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

    const companyName =
      String(row.companyName || row.name || row.rawName || "").trim();
    const leadContact =
      String(row.leadContact || "").trim();
    const displayName = companyName || leadContact || "(unknown)";

    const address = String(
      row.buildingAddress || row.inputAddress || row.address || ""
    ).trim();
    const city = String(row.city || "").trim();
    const province = String(row.province || "QC").trim();
    const postalCode = String(row.postalCode || "").trim();

    const residential = isLikelyResidentialOrInsufficient(row);

    leadsToExport.push({
      lead_owner_name: displayName,
      companyName,
      leadContact,
      address,
      city,
      province,
      postalCode,
      buildingAddress: address,
      phone,
      inputPhones: [phone],
      candidatePhones: [
        {
          phone,
          confidence: "high",
          source: "imported_with_phone",
          relationship_to_lead_owner: "owner",
          phone_owner_name: displayName,
        },
      ],
      status: "ready_to_call",
      likelyResidential: residential,
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
