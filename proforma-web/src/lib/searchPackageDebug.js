// proforma-web/src/lib/searchPackageDebug.js
//
// Dev-only helpers powering the Phone Finder search-package preview.
//
// The preview is gated on a localStorage flag (`pf_spdebug`) so it stays
// invisible to normal users. Power users / dev sessions can enable it via:
//   localStorage.setItem("pf_spdebug", "1")  // then refresh
//   localStorage.setItem("pf_spdebug", "0")  // disable
//
// This module deliberately doesn't import React — it's pure logic so the
// component above stays a thin shell and the tests can run without
// @testing-library/react.

import {
  buildSearchPackages,
  aggregateSearchPackageStats,
  auditSearchPackages,
  formatSearchPackageRow,
} from "./searchPackage.js";
import {
  normalizeHeaderKey,
  extractRoleData,
} from "./roleImport.js";

const FLAG_KEY = "pf_spdebug";

// True when the dev flag is on. Wrapped in try/catch because some browser
// contexts (private mode, certain embedded webviews) throw on localStorage
// access. Returning false is the safe default — the preview button just
// stays hidden.
export function isSearchPackageDebugEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

// ─── Raw rôle-row detection + adaptation ──────────────────────────────────

// A row is "rôle-style" if it contains a column whose normalized name is
// exactly "proprietaire" — the lead owner column present in every Québec
// rôle d'évaluation export.
function isRoleStyleRow(row) {
  if (!row || typeof row !== "object") return false;
  return Object.keys(row).some((k) => normalizeHeaderKey(k) === "proprietaire");
}

// Phone Finder wraps each imported row in a shaped record with a `rawRow`
// pointer back to the original spreadsheet object. Reach through that
// wrapper so detection and extraction work whether we receive the original
// Excel rows directly or the PF-processed wrappers.
function getRawRow(row) {
  if (!row || typeof row !== "object") return row;
  return Object.prototype.hasOwnProperty.call(row, "rawRow") ? (row.rawRow || row) : row;
}

// Returns true when the batch looks like it came from a raw rôle file.
// Sampling the first few rows is enough — real rôle sheets are uniform.
function isRoleFormat(rows) {
  if (!rows.length) return false;
  const sample = rows.slice(0, Math.min(5, rows.length));
  return sample.some((row) => isRoleStyleRow(getRawRow(row)));
}

// Convert a batch of raw rôle rows (or PF-wrapped rôle rows) to lead-like
// records for buildSearchPackages, emitting ONE record per owner-slot draft.
//
// Why not reuse buildOwnersAndLeadsFromRole here: that function groups by
// mailing address (one Owner per unique ownerKey), so two different owners
// sharing an address — e.g. a person and a fiducie co-owning a building —
// collapse into a single Owner record. The chosen displayName drives
// classification, hiding the fiducie/company under the person's name.
//
// By emitting one record per draft we give buildSearchPackages the raw
// (name, mailing) pairs it needs to:
//   • group correctly by (normalized_name | normalized_postal)
//   • classify each owner independently
//   • collapse same-name-same-mailing across property rows into one package
//   • flag same-name-different-mailing as duplicate_different_address
function adaptRoleRowsToLeadLike(rows) {
  const rawRows = rows.map(getRawRow).filter((r) => r && typeof r === "object");
  if (!rawRows.length) return [];
  // Collect all unique header names so extractRoleData finds every slot column.
  const headers = [...new Set(rawRows.flatMap((r) => Object.keys(r)))];
  const parsed = extractRoleData({ rows: rawRows, headers });
  if (!parsed.ownersMap.size) return [];

  const propById = new Map(parsed.properties.map((p) => [p.id, p]));
  const records = [];

  for (const [, drafts] of parsed.ownersMap) {
    for (const draft of drafts) {
      const postal = draft.postalAddress || {};
      const prop = propById.get(draft.propertyId);
      // Append building-level candidates (relationship: "building") from the
      // property row; buildSearchPackages will deduplicate via
      // mergePhoneCandidates when it flattens the group's candidatePhones.
      const candidatePhones = [
        ...(draft.candidatePhones || []),
        ...(prop?.candidatePhones || []),
      ];
      records.push({
        companyName: draft.name,
        address: prop?.adresseImmeuble || "",
        city: prop?.ville || "",
        province: "QC",
        postalCode: prop?.codePostalImmeuble || "",
        mailing_address: postal.street || "",
        mailing_city: postal.city || "",
        mailing_province: postal.province || "QC",
        mailing_postal_code: postal.postalCode || "",
        phones: draft.phones || [],
        phone: (draft.phones || [])[0] || "",
        candidatePhones,
        units: prop ? (prop.nbTotalUnites || prop.nbLogements || 0) : 0,
        utilisation: prop?.utilisation || "",
        status: draft.status || "",
      });
    }
  }

  return records;
}

// Build the data shape consumed by the preview panel from a list of
// already-imported lead-like rows (the same rows that pendingLookup carries
// in PhoneFinder). Combines the aggregate stats + targeted audit buckets +
// pre-formatted row strings for the top high-value-no-phone list.
//
// When the input looks like raw rôle rows (have "Propriétaire" columns),
// every populated owner slot is fanned out to its own lead-like record
// before package-building runs so that each owner is classified and scored
// independently — including slot-2+ owners and fiducies/companies that
// share a mailing address with an individual.
//
// Pure — no localStorage / DOM / network. Testable in isolation.
export function buildSearchPackagePreviewData(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const topN = Number.isFinite(options.topN) ? options.topN : 25;

  // Detect raw rôle rows (directly or wrapped inside Phone Finder rows) and
  // fan out every owner slot to a lead-like record so buildSearchPackages
  // sees correct per-owner name/mailing/phone data. Without this step Phone
  // Finder rows carry `inputPhones` not `phones`, `name` not `companyName`,
  // and slots beyond slot 0 are invisible.
  const packagableRows =
    safeRows.length > 0 && isRoleFormat(safeRows)
      ? adaptRoleRowsToLeadLike(safeRows)
      : safeRows;

  const packages = buildSearchPackages(packagableRows);
  const stats = aggregateSearchPackageStats(packages);
  const audit = auditSearchPackages(packages, { topN });

  const topRows = audit.top_high_value_without_phone.map((pkg) => ({
    name: pkg.lead_owner_name || "(no name)",
    category: pkg.legal_entity_category,
    leadValue: pkg.lead_value_priority,
    searchNeed: pkg.search_need_priority,
    strategy: pkg.search_strategy,
    properties: (pkg.associated_properties || []).length,
    units: (pkg.associated_properties || [])
      .reduce((s, p) => s + (Number(p?.units) || 0), 0),
    mailingAddress: pkg.mailing_address || "",
    mailingCity: pkg.mailing_city || "",
    summary: formatSearchPackageRow(pkg),
  }));

  return {
    inputRowCount: safeRows.length,
    packageCount: packages.length,
    leadValue: { ...stats.by_lead_value },
    searchNeed: { ...stats.by_search_need },
    withPhone: audit.with_phone,
    withoutPhone: audit.without_phone,
    withOwnerFilePhone: audit.with_owner_file_phone,
    numberedCompanies: stats.numbered_companies,
    trusts: stats.by_category.trust || 0,
    individuals: stats.individuals,
    withMailingAddress: stats.with_mailing_address,
    totalProperties: stats.total_properties,
    duplicateDifferentAddress: audit.duplicate_different_address.length,
    suspiciousCount: audit.suspicious.length,
    topHighValueWithoutPhone: topRows,
    // The full lists are exposed too in case callers want to drill down or
    // export. Kept as plain arrays so React can map them directly.
    numberedCompaniesWithoutPhone: audit.numbered_companies_without_phone,
    trustsWithoutPhone: audit.trusts_without_phone,
    companiesWithMailingNoPhone: audit.companies_with_mailing_no_phone,
  };
}
