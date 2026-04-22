#!/usr/bin/env node
// dry_run_victoriaville.mjs
// Offline dry-run: load Victoriaville_clean.xlsx via Python → JSON, then
// call planPhoneLookups(openaiClient: null) and print bucket counts +
// sample enrich_owner_postal plans.
//
// Usage:  node scripts/dry_run_victoriaville.mjs [path/to/file.xlsx]
//
// No API calls are made (openaiClient is explicitly null).

import { execSync } from "child_process";
import { planPhoneLookups } from "../services/phoneLookupPlanner.js";

const XLSX_PATH =
  process.argv[2] ||
  "/Users/anthonymakeen/Library/Application Support/Claude/local-agent-mode-sessions/693ecf8b-f8da-4aeb-8d7f-623c475d6212/6c9aeee6-737f-476c-bc90-d2daca6f2560/local_7a789c2f-0bb6-4906-8eb6-fb56d6c75578/uploads/Victoriaville_clean.xlsx";

// ── Step 1: parse xlsx with Python (openpyxl) ────────────────────────────────
const PYTHON = `
import json, sys
try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl not installed — run: pip install openpyxl")

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb.active
headers = [str(c.value).strip() if c.value is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
rows = []
for r in ws.iter_rows(min_row=2, values_only=True):
    obj = {}
    for h, v in zip(headers, r):
        if h:
            obj[h] = "" if v is None else str(v).strip()
    rows.append(obj)
print(json.dumps(rows))
`;

console.log(`Loading: ${XLSX_PATH}\n`);
let rows;
try {
  const json = execSync(`python3 -c '${PYTHON.replace(/'/g, "'\\''")}' "${XLSX_PATH}"`, {
    maxBuffer: 50 * 1024 * 1024,
  }).toString();
  rows = JSON.parse(json);
} catch (err) {
  console.error("Failed to parse xlsx:", err.message);
  process.exit(1);
}
console.log(`Parsed ${rows.length} rows from xlsx.\n`);

// ── Step 2: run planner (no API, deterministic fallback only) ─────────────────
const { plans, stats } = await planPhoneLookups({ rows, openaiClient: null });

// ── Step 3: report ────────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════");
console.log("  BUCKET COUNTS");
console.log("═══════════════════════════════════════════");
console.log(`  use_file_phone      : ${stats.useFilePhone}`);
console.log(`  enrich_owner_postal : ${stats.enrichOwnerPostal}`);
console.log(`  skip_no_lead        : ${stats.skipNoLead}`);
console.log(`  total rows          : ${stats.total}`);
console.log("═══════════════════════════════════════════\n");

const samples = plans
  .filter(p => p?.strategy === "enrich_owner_postal")
  .slice(0, 5);

if (samples.length === 0) {
  console.log("No enrich_owner_postal plans found.");
} else {
  console.log("SAMPLE enrich_owner_postal plans:");
  console.log("───────────────────────────────────────────");
  for (const p of samples) {
    console.log(`  row ${p.rowIdx}`);
    console.log(`    owner : ${p.owner?.displayName ?? "(none)"}`);
    console.log(`    query : ${p.plannedQuery?.query ?? "(none)"}`);
    console.log();
  }
}
