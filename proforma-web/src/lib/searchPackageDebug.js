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
  buildOwnersAndLeadsFromRole,
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

// Convert a batch of raw rôle rows (or PF-wrapped rôle rows) to Owner-shaped
// records ready for buildSearchPackages. Uses the same extraction pipeline as
// the full rôle import so every owner slot is included, mailing addresses are
// parsed, and phones are correctly tagged by relationship (owner vs. building).
function adaptRoleRowsToOwners(rows) {
  const rawRows = rows.map(getRawRow).filter((r) => r && typeof r === "object");
  if (!rawRows.length) return [];
  // Collect all unique header names across every row so extractRoleData can
  // find slot columns regardless of which row was examined first.
  const headers = [...new Set(rawRows.flatMap((r) => Object.keys(r)))];
  const parsed = extractRoleData({ rows: rawRows, headers });
  const { allOwners } = buildOwnersAndLeadsFromRole(parsed, []);
  return allOwners;
}

// Build the data shape consumed by the preview panel from a list of
// already-imported lead-like rows (the same rows that pendingLookup carries
// in PhoneFinder). Combines the aggregate stats + targeted audit buckets +
// pre-formatted row strings for the top high-value-no-phone list.
//
// When the input looks like raw rôle rows (have "Propriétaire" columns),
// the rows are first adapted to Owner-shaped records via the rôle import
// pipeline so that all owner slots, mailing addresses, and file phones are
// correctly mapped before package-building runs.
//
// Pure — no localStorage / DOM / network. Testable in isolation.
export function buildSearchPackagePreviewData(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const topN = Number.isFinite(options.topN) ? options.topN : 25;

  // Detect raw rôle rows (directly or wrapped inside Phone Finder rows) and
  // convert them to Owner-shaped records so buildSearchPackages sees the
  // correct owner/mailing/phone structure. Without this step Phone Finder
  // rows have the wrong shape: phones are in `inputPhones` not `phones`,
  // names are in `name` not `companyName`, and slots beyond slot 0 are
  // invisible to the package builder.
  const packagableRows =
    safeRows.length > 0 && isRoleFormat(safeRows)
      ? adaptRoleRowsToOwners(safeRows)
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
