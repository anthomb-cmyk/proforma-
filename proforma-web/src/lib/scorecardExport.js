// proforma-web/src/lib/scorecardExport.js
//
// Pure helper for building a scorecard CSV from enrichment results.
// No network, no React — fully testable in isolation.
//
// CSV format: RFC 4180 compliant.
//   - Fields containing commas, double-quotes, or newlines are enclosed in double-quotes.
//   - Double-quotes within fields are escaped as two double-quotes ("").
//   - Newlines within fields are replaced with a space.
//   - CSV injection mitigation: leading =, +, -, @ are prefixed with ' (apostrophe).

const CSV_HEADERS = [
  "owner",
  "status",
  "decision",
  "bestPhone",
  "bestPhoneBelongsTo",
  "phoneRelationship",
  "confidence",
  "bestEmail",
  "evidence_summary",
  "sources",
];

// ─── RFC 4180 helpers ─────────────────────────────────────────────────────────

/**
 * Sanitize a cell value:
 *   1. Replace newlines with a space (keeps CSV single-line per record).
 *   2. Prefix with ' if the value starts with a formula-injection character.
 *   3. Escape double-quotes by doubling them.
 *   4. Wrap in double-quotes if the value contains commas, double-quotes, or CR/LF.
 *
 * @param {*} raw
 * @returns {string}
 */
function csvCell(raw) {
  if (raw === null || raw === undefined) raw = "";
  let value = String(raw)
    // Replace all newlines (CR, LF, CRLF) with a space.
    .replace(/\r\n|\r|\n/g, " ")
    .trim();

  // CSV injection mitigation: prefix with apostrophe.
  if (/^[=+\-@]/.test(value)) {
    value = "'" + value;
  }

  // Escape internal double-quotes.
  const hasQuote = value.includes('"');
  if (hasQuote) {
    value = value.replace(/"/g, '""');
  }

  // Wrap if the value contains commas, double-quotes (already escaped), or CR/LF.
  if (hasQuote || value.includes(",") || value.includes("\r") || value.includes("\n")) {
    value = `"${value}"`;
  }

  return value;
}

/**
 * Build a CSV string from all enriched results and the review-decision Map.
 *
 * @param {Map<string, object>|object[]} allEnrichedResults
 *   A Map<packageKey, result> or an Array of result objects.
 * @param {Map<string, {decision: string}>} [reviewDecisions]
 *   Optional map from packageKey to { decision: "accepted"|"rejected"|"skipped" }.
 * @returns {string}  Complete CSV string (header + rows), newline-terminated.
 */
export function buildScorecardCSV(allEnrichedResults, reviewDecisions = new Map()) {
  const rows = [];

  // Support both Map and Array input.
  const entries =
    allEnrichedResults instanceof Map
      ? [...allEnrichedResults.entries()]
      : (Array.isArray(allEnrichedResults)
          ? allEnrichedResults.map((r, i) => [String(i), r])
          : []);

  for (const [packageKey, result] of entries) {
    if (!result) continue;

    const decision = reviewDecisions.get(packageKey)?.decision || "";

    // Evidence summary: last 3 lines, joined with " | ", newlines stripped.
    const evidenceLines = Array.isArray(result.evidence) ? result.evidence : [];
    const evidenceSummary = evidenceLines
      .slice(-3)
      .map((l) => String(l || "").replace(/[\r\n]+/g, " ").trim())
      .join(" | ");

    // Sources: distinct phone-candidate sources.
    const phoneCandidates = Array.isArray(result.phoneCandidates) ? result.phoneCandidates : [];
    const sources = [...new Set(phoneCandidates.map((c) => c.source).filter(Boolean))].join(",");

    rows.push([
      csvCell(result.lead_owner_name),
      csvCell(result.status),
      csvCell(decision),
      csvCell(result.bestPhone),
      csvCell(result.bestPhoneBelongsTo),
      csvCell(result.phoneRelationship),
      csvCell(result.confidence),
      csvCell(result.bestEmail),
      csvCell(evidenceSummary),
      csvCell(sources),
    ].join(","));
  }

  const header = CSV_HEADERS.join(",");
  if (rows.length === 0) return header + "\n";
  return header + "\n" + rows.join("\n") + "\n";
}
