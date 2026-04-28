// proforma-web/src/lib/scorecardExport.test.js
//
// Tests for scorecardExport.js — Jest/react-scripts compatible.

import { buildScorecardCSV } from "./scorecardExport.js";

/* ──────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ──────────────────────────────────────────────────────────────────────────── */

function parseCSVRows(csv) {
  const lines = csv.split("\n").filter((l) => l.trim());
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
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

describe("buildScorecardCSV", () => {
  /* 1. Empty input → header-only CSV */
  test("empty input returns header-only CSV", () => {
    const csv = buildScorecardCSV(new Map());
    const lines = csv.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^owner,/);
    expect(lines[0]).toContain("sources");
  });

  /* 2. Owner with comma → properly quoted */
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
    expect(csv).toContain('"Tremblay, Jean"');

    const rows = parseCSVRows(csv);
    expect(rows.length).toBe(1);
    expect(rows[0].owner).toBe("Tremblay, Jean");
  });

  /* 3. Multi-line evidence → single CSV line */
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
    expect(csvLines.length).toBe(2); // 1 header + 1 data
  });

  /* 4. reviewDecisions accepted → decision column */
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
    const rows = parseCSVRows(csv);
    expect(rows[0].decision).toBe("accepted");
  });

  /* 5. CSV injection mitigation */
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
    expect(csv).toContain("'=DANGEROUS");
    expect(csv).toContain("'+exploit");
    expect(csv).toContain("'-1+2");
    expect(csv).toContain("'@user");
  });

  /* 6. Evidence summary — last 3 lines */
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
    const rows = parseCSVRows(csv);
    const summary = rows[0].evidence_summary;
    expect(summary).toContain("line3");
    expect(summary).toContain("line4");
    expect(summary).toContain("line5");
    expect(summary).not.toContain("line1");
    expect(summary).not.toContain("line2");
  });

  /* 7. Sources — deduplicated */
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
    const rows = parseCSVRows(csv);
    const sources = rows[0].sources.split(",");
    expect(sources.filter((s) => s === "direct_entity").length).toBe(1);
    expect(sources).toContain("mailing");
    expect(sources).toContain("page");
  });

  /* 8. Array input */
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
    const rows = parseCSVRows(csv);
    expect(rows.length).toBe(2);
    expect(rows[0].owner).toBe("Company A");
    expect(rows[1].owner).toBe("Company B");
  });
});
