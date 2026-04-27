#!/usr/bin/env node
// scripts/process-dispatch-leads.mjs
//
// Local-only dev pipeline that reads a Dispatch-generated leads CSV (one
// row per lead) and prints the search-package report + targeted audits.
//
// Usage:
//   node scripts/process-dispatch-leads.mjs <path-to-csv>
//   node scripts/process-dispatch-leads.mjs <path-to-csv> --top 50
//
// Defaults:
//   path = scripts/sample-fixtures/leads.dispatch-sample.csv
//   top  = 25
//
// CSV header detection is permissive — French + English variants are both
// recognized (see proforma-web/src/lib/dispatchLeadsImport.js for the
// candidate-header lists).
//
// Pure / zero-network. No Google Places. Read-only.
//
// Real owner / contact CSVs MUST NOT be committed; tmp/ + *.xlsx / *.xls
// are gitignored at the repo root.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { parseDispatchLeadsCsv } from "../proforma-web/src/lib/dispatchLeadsImport.js";
import {
  buildSearchPackages,
  formatSearchPackageReport,
  formatSearchPackageRow,
  auditSearchPackages,
} from "../proforma-web/src/lib/searchPackage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { file: "", topN: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--top") args.topN = Number(argv[++i]) || 25;
    else if (!args.file) args.file = a;
  }
  return args;
}

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith("~/") || p === "~") return path.join(os.homedir(), p.slice(1));
  return p;
}

function printAuditDetail(title, packages, limit) {
  console.log("");
  console.log(`=== ${title} (${packages.length}) ===`);
  if (!packages.length) {
    console.log("  (none)");
    return;
  }
  packages.slice(0, limit).forEach((p, i) => {
    console.log(`${String(i + 1).padStart(3, " ")}. ${formatSearchPackageRow(p)}`);
  });
  if (packages.length > limit) {
    console.log(`  … +${packages.length - limit} more`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaultFixture = path.join(__dirname, "sample-fixtures", "leads.dispatch-sample.csv");
  const csvPath = expandHome(args.file || defaultFixture);

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const { headers, headerMap, rows } = parseDispatchLeadsCsv(text);

  console.log(`# process-dispatch-leads`);
  console.log(`# source: ${csvPath}`);
  console.log(`# CSV rows: ${rows.length} · headers detected: ${Object.keys(headerMap).length}/${headers.length}`);

  // List which canonical fields got mapped, and which CSV columns went
  // unrecognized — useful when Dispatch changes its column naming.
  const mappedFields = Object.keys(headerMap);
  if (mappedFields.length) {
    console.log(`# mapped fields:`);
    mappedFields.forEach((f) => console.log(`    ${f.padEnd(22)} ← "${headerMap[f]}"`));
  }
  const unmapped = headers.filter((h) => !Object.values(headerMap).includes(h));
  if (unmapped.length) {
    console.log(`# unmapped CSV columns (carried but not used by the builder):`);
    unmapped.forEach((h) => console.log(`    "${h}"`));
  }

  const packages = buildSearchPackages(rows);
  const totalLogements = rows.reduce((s, r) => s + (Number(r?.units) || 0), 0);

  console.log("");
  console.log("=== Pipeline counts ===");
  console.log(`packages after grouping: ${packages.length}`);
  console.log(`total logements:         ${totalLogements}`);

  console.log("");
  console.log(formatSearchPackageReport(packages, { topN: args.topN }));

  const audit = auditSearchPackages(packages, { topN: args.topN });
  console.log("");
  console.log("=== Audit summary ===");
  console.log(`packages with any phone:               ${audit.with_phone}`);
  console.log(`packages without any phone:            ${audit.without_phone}`);
  console.log(`packages with owner-direct file phone: ${audit.with_owner_file_phone}`);

  printAuditDetail(
    `Top ${args.topN} HIGH-VALUE owners without any phone (sorted by portfolio)`,
    audit.top_high_value_without_phone,
    args.topN,
  );
  printAuditDetail("Numbered companies without phone", audit.numbered_companies_without_phone, args.topN);
  printAuditDetail("Trusts / fiducies without phone", audit.trusts_without_phone, args.topN);
  printAuditDetail("Companies with mailing address but no phone", audit.companies_with_mailing_no_phone, args.topN);

  console.log("");
  console.log(`=== Suspicious / classification flags (${audit.suspicious.length}) ===`);
  if (!audit.suspicious.length) {
    console.log("  (none)");
  } else {
    const byKind = {};
    for (const s of audit.suspicious) (byKind[s.kind] = byKind[s.kind] || []).push(s);
    for (const [kind, entries] of Object.entries(byKind)) {
      console.log(`  · ${kind}: ${entries.length}`);
      entries.slice(0, 5).forEach((e) => {
        console.log(`      - ${e.package.lead_owner_name || "(no name)"} — ${e.detail}`);
      });
      if (entries.length > 5) console.log(`      … +${entries.length - 5} more`);
    }
  }
}

main();
