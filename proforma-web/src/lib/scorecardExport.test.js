// proforma-web/src/lib/scorecardExport.test.js
//
// Tests for scorecardExport.js
// Run with: node --test (from proforma-web) or via react-scripts test

import test from "node:test";
import assert from "node:assert/strict";
import { buildScorecardCSV } from "./scorecardExport.js";

/* ──────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ──────────────────────────────────────────────────────────────────────────── */

function parseCSV(csv) {
  const lines = csv.split("\n").filter((l) => l.trim());
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    // Very simple parser — handles quoted fields.
    const cells = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === '"' && line[j + 1] === '"') { j += 2; }
          else if (line[j] === '"') { j++; break; }
          else { j++; }
        }
        cells.push(line.slice(i + 1, j - 1).replace(/""/g, '"'));
        i = j;
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) { cells.push(line.slice(i)); i = line.length; }
        else { cells.push(line.slice(i, end)); i = end + 1; }
      }
    }
    const row = {};
    header.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    return row;
  });
}

/* ──────────────────────────────────────────────────────────────────────────── */
/*  1. Empty input → header-only CSV                                            */
/* ──────────────────────────────────────────────────────────────────────────── */

test("empty input returns header-only CSV", () => {
  const csv = buildScorecardCSV(new Map());
  const lines = csv.split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "should have exactly 1 line (header)");
  assert.ok(lines[0].startsWith("owner,"), `header should start with owner, got: "${lines[0]}"`);
  assert.ok(lines[0].includes("sources"), "header should contain sources column");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  2. Owner with comma in name is properly quoted                              */
/* ──────────────────────────────────────────────────────────────────────────── */

test("owner name containing a comma is properly quoted per RFC 4180", () => {
  const result = {
    lead_owner_name: "Tremblay, Jean",
    status: "ready_to_call",
    bestPhone: "(514) 555-0101",
    bestPhoneBelongsTo: null,
    phoneRelationship: "direct_entity_match",
    confidence: "high",
    bestEmail: null,
    evidence: ["best_phone: ..."],
    phoneCandidates: [{ source: "direct_entity" }],
  };
  const csv = buildScorecardCSV(new Map([["key1", result]]));
  assert.ok(csv.includes('"Tremblay, Jean"'), `comma-containing name should be quoted in: ${csv}`);

  const rows = parseCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner, "Tremblay, Jean");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  3. Multi-line evidence is on a single line in the CSV                       */
/* ──────────────────────────────────────────────────────────────────────────── */

test("multi-line evidence strings are collapsed to a single CSV line", () => {
  const result = {
    lead_owner_name: "Gestion ABC Inc.",
    status: "needs_review",
    bestPhone: null,
    bestPhoneBelongsTo: null,
    phoneRelationship: null,
    confidence: "low",
    bestEmail: null,
    evidence: ["direct_query: q → 3 results\nsome detail", "best_phone: ..."],
    phoneCandidates: [],
  };
  const csv = buildScorecardCSV(new Map([["k", result]]));
  const csvLines = csv.split("\n").filter((l) => l.trim());
  // 1 header + 1 data row = 2 lines max
  assert.equal(csvLines.length, 2, `expected 2 lines, got ${csvLines.length}:\n${csv}`);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  4. reviewDecisions with accepted show up as decision=accepted               */
/* ──────────────────────────────────────────────────────────────────────────── */

test("reviewDecisions with accepted appear as decision=accepted in CSV", () => {
  const result = {
    lead_owner_name: "Placement XYZ Inc.",
    status: "ready_to_call",
    bestPhone: "(514) 555-0102",
    bestPhoneBelongsTo: "Placement XYZ",
    phoneRelationship: "direct_entity_match",
    confidence: "high",
    bestEmail: null,
    evidence: [],
    phoneCandidates: [],
  };
  const decisions = new Map([["pkgA", { decision: "accepted" }]]);
  const csv = buildScorecardCSV(new Map([["pkgA", result]]), decisions);
  const rows = parseCSV(csv);
  assert.equal(rows[0].decision, "accepted");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  5. CSV injection mitigation                                                 */
/* ──────────────────────────────────────────────────────────────────────────── */

test("CSV injection characters (=, +, -, @) get a leading apostrophe", () => {
  const result = {
    lead_owner_name: "=DANGEROUS",
    status: "+exploit",
    bestPhone: "-1+2",
    bestPhoneBelongsTo: "@user",
    phoneRelationship: null,
    confidence: null,
    bestEmail: null,
    evidence: [],
    phoneCandidates: [],
  };
  const csv = buildScorecardCSV(new Map([["k", result]]));
  assert.ok(csv.includes("'=DANGEROUS"), `= should be prefixed with ': ${csv}`);
  assert.ok(csv.includes("'+exploit"), `+ should be prefixed with ': ${csv}`);
  assert.ok(csv.includes("'-1+2"), `- should be prefixed with ': ${csv}`);
  assert.ok(csv.includes("'@user"), `@ should be prefixed with ': ${csv}`);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  6. Evidence summary uses last 3 lines joined with " | "                     */
/* ──────────────────────────────────────────────────────────────────────────── */

test("evidence_summary contains last 3 evidence lines joined with pipe", () => {
  const result = {
    lead_owner_name: "Test Inc.",
    status: "ready_to_call",
    bestPhone: "(514) 555-0103",
    bestPhoneBelongsTo: "Test Inc.",
    phoneRelationship: "direct_entity_match",
    confidence: "high",
    bestEmail: null,
    evidence: ["line1", "line2", "line3", "line4", "line5"],
    phoneCandidates: [],
  };
  const csv = buildScorecardCSV(new Map([["k", result]]));
  const rows = parseCSV(csv);
  const summary = rows[0].evidence_summary;
  // Should be "line3 | line4 | line5" (last 3)
  assert.ok(summary.includes("line3"), `expected line3 in summary: "${summary}"`);
  assert.ok(summary.includes("line4"), `expected line4 in summary: "${summary}"`);
  assert.ok(summary.includes("line5"), `expected line5 in summary: "${summary}"`);
  assert.ok(!summary.includes("line1"), `line1 should not be in summary: "${summary}"`);
  assert.ok(!summary.includes("line2"), `line2 should not be in summary: "${summary}"`);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  7. Sources is distinct comma-list of phoneCandidates sources                */
/* ──────────────────────────────────────────────────────────────────────────── */

test("sources is a deduplicated comma-list of phone candidate sources", () => {
  const result = {
    lead_owner_name: "Test Inc.",
    status: "ready_to_call",
    bestPhone: "(514) 555-0104",
    bestPhoneBelongsTo: null,
    phoneRelationship: null,
    confidence: "medium",
    bestEmail: null,
    evidence: [],
    phoneCandidates: [
      { source: "direct_entity" },
      { source: "mailing" },
      { source: "direct_entity" }, // duplicate
      { source: "page" },
    ],
  };
  const csv = buildScorecardCSV(new Map([["k", result]]));
  const rows = parseCSV(csv);
  const sources = rows[0].sources.split(",");
  // deduplicated — direct_entity should appear only once
  assert.equal(sources.filter((s) => s === "direct_entity").length, 1);
  assert.ok(sources.includes("mailing"), "mailing should be in sources");
  assert.ok(sources.includes("page"), "page should be in sources");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  8. Array input also works (not just Map)                                    */
/* ──────────────────────────────────────────────────────────────────────────── */

test("buildScorecardCSV accepts an Array of results (not just Map)", () => {
  const results = [
    { lead_owner_name: "Company A", status: "ready_to_call", bestPhone: "(514) 555-0105",
      bestPhoneBelongsTo: null, phoneRelationship: null, confidence: "medium",
      bestEmail: null, evidence: [], phoneCandidates: [] },
    { lead_owner_name: "Company B", status: "no_contact_found", bestPhone: null,
      bestPhoneBelongsTo: null, phoneRelationship: null, confidence: "low",
      bestEmail: null, evidence: [], phoneCandidates: [] },
  ];
  const csv = buildScorecardCSV(results);
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].owner, "Company A");
  assert.equal(rows[1].owner, "Company B");
});
