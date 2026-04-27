#!/usr/bin/env node
// scripts/process-role-file.mjs
//
// Local-only dev pipeline for inspecting an owner/entity search-package
// audit on a real Québec rôle d'évaluation XLSX. Reuses the existing
// extractRoleData → buildOwnersAndLeadsFromRole path, then runs the
// search-package builder + audit helpers and prints the report.
//
// Usage:
//   node scripts/process-role-file.mjs <path-to-xlsx>
//   node scripts/process-role-file.mjs <path-to-xlsx> --no-csv
//   node scripts/process-role-file.mjs <path-to-xlsx> --top 50
//
// Outputs (under <repo>/tmp/, gitignored):
//   tmp/owners_extracted.csv  — one row per owner produced by the rôle parser
//   tmp/leads.csv             — one row per lead emitted by the rôle parser
//
// Pass --no-csv to skip the CSV write step.
//
// Requires: python3 + the `openpyxl` package (same Python pattern as
// dry_run_victoriaville.mjs). No network calls. No Google Places.
//
// Real owner / contact data MUST NOT be committed. The .gitignore at the
// repo root excludes tmp/ + *.xlsx / *.xls; double-check that nothing
// containing real numbers gets staged before pushing.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  extractRoleData,
  buildOwnersAndLeadsFromRole,
} from "../proforma-web/src/lib/roleImport.js";
import {
  buildSearchPackages,
  formatSearchPackageReport,
  auditSearchPackages,
  formatSearchPackageRow,
} from "../proforma-web/src/lib/searchPackage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── Argv ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { file: "", topN: 25, csv: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-csv") args.csv = false;
    else if (a === "--top") args.topN = Number(argv[++i]) || 25;
    else if (!args.file) args.file = a;
  }
  return args;
}

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith("~/") || p === "~") return path.join(os.homedir(), p.slice(1));
  return p;
}

// ─── XLSX → JSON via Python + openpyxl ────────────────────────────────────
const PYTHON_LOADER = `
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
out = { "headers": headers, "rows": rows }
print(json.dumps(out))
`;

function loadXlsxRows(xlsxPath) {
  const cmd = `python3 -c '${PYTHON_LOADER.replace(/'/g, "'\\''")}' "${xlsxPath}"`;
  let json;
  try {
    json = execSync(cmd, { maxBuffer: 200 * 1024 * 1024 }).toString();
  } catch (err) {
    console.error("Failed to parse xlsx via openpyxl:");
    console.error(err.message);
    process.exit(2);
  }
  return JSON.parse(json);
}

// ─── CSV writing ───────────────────────────────────────────────────────────

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, headers, rows) {
  const lines = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  // BOM for Excel French-locale compatibility.
  fs.writeFileSync(filePath, "﻿" + lines.join("\n"), "utf8");
}

function ownerToCsvRow(owner) {
  const phones = (owner.phones || []).join(" | ");
  const emails = (owner.emails || []).join(" | ");
  const websites = (owner.websites || []).join(" | ");
  const props = (owner.buildings || []).length;
  const totalUnits = (owner.buildings || []).reduce((s, b) => s + (Number(b?.units) || 0), 0);
  const aliases = (owner.aliases || []).join(" | ");
  const contactNames = (owner.contactNames || []).join(" | ");
  const postal = owner.postalAddress || {};
  return {
    owner_id: owner.id,
    owner_key: owner.ownerKey,
    display_name: owner.displayName || "",
    aliases,
    contact_names: contactNames,
    mailing_street: postal.street || "",
    mailing_city: postal.city || "",
    mailing_province: postal.province || "",
    mailing_postal_code: postal.postalCode || "",
    properties: props,
    total_units: totalUnits,
    phones,
    emails,
    websites,
    candidate_phones: (owner.candidatePhones || []).length,
    candidate_emails: (owner.candidateEmails || []).length,
    candidate_websites: (owner.candidateWebsites || []).length,
    lookup_status: owner.lookupStatus || "",
  };
}

function leadToCsvRow(lead) {
  return {
    lead_id: lead.id,
    owner_ids: (lead.ownerIds || []).join(" | "),
    address: lead.address || "",
    city: lead.city || "",
    province: lead.province || "",
    postal_code: lead.postalCode || "",
    matricule: lead.matricule || "",
    units: lead.units || 0,
    utilisation: lead.utilisation || "",
    assessment: lead.assessment || "",
    year_built: lead.yearBuilt || "",
    phone: lead.phone || "",
    email: lead.email || "",
    website: lead.website || "",
    phones: (lead.phones || []).join(" | "),
    emails: (lead.emails || []).join(" | "),
    websites: (lead.websites || []).join(" | "),
    candidate_phones: (lead.candidatePhones || []).length,
    candidate_emails: (lead.candidateEmails || []).length,
    candidate_websites: (lead.candidateWebsites || []).length,
    lookup_status: lead.lookupStatus || "",
  };
}

// ─── Reporting ─────────────────────────────────────────────────────────────

function printAuditDetail(title, packages, limit = 25) {
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

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: node scripts/process-role-file.mjs <path-to-xlsx> [--no-csv] [--top N]");
    process.exit(1);
  }
  const xlsxPath = expandHome(args.file);
  if (!fs.existsSync(xlsxPath)) {
    console.error(`File not found: ${xlsxPath}`);
    process.exit(1);
  }

  console.log(`# process-role-file`);
  console.log(`# source: ${xlsxPath}`);
  console.log(`# loading via python3 + openpyxl…`);
  const { headers, rows } = loadXlsxRows(xlsxPath);
  console.log(`# parsed ${rows.length} rows · ${headers.length} headers`);

  const parsed = extractRoleData({ headers, rows });
  const { allOwners, leads } = buildOwnersAndLeadsFromRole(parsed, [], { sourceFile: path.basename(xlsxPath) });

  // Logements aggregate.
  const totalLogements = (parsed.properties || []).reduce(
    (s, p) => s + (Number(p?.nbLogements) || 0),
    0,
  );
  const ownersWithPhone = allOwners.filter((o) => (o.phones || []).length > 0).length;
  const ownersWithoutPhone = allOwners.length - ownersWithPhone;

  console.log("");
  console.log("=== Pipeline counts ===");
  console.log(`owners after grouping: ${allOwners.length}`);
  console.log(`leads emitted:         ${leads.length}`);
  console.log(`total logements:       ${totalLogements}`);
  console.log(`owners with phone:     ${ownersWithPhone}`);
  console.log(`owners without phone:  ${ownersWithoutPhone}`);

  // ─ Search packages ─
  const packages = buildSearchPackages(allOwners);
  console.log("");
  console.log(formatSearchPackageReport(packages, { topN: args.topN }));

  // ─ Targeted audits ─
  const audit = auditSearchPackages(packages, { topN: args.topN });
  console.log("");
  console.log("=== Audit summary ===");
  console.log(`packages with any phone:           ${audit.with_phone}`);
  console.log(`packages without any phone:        ${audit.without_phone}`);
  console.log(`packages with owner-direct file phone: ${audit.with_owner_file_phone}`);

  printAuditDetail(
    `Top ${args.topN} HIGH-VALUE owners without any phone (sorted by portfolio)`,
    audit.top_high_value_without_phone,
    args.topN,
  );
  printAuditDetail(
    "Numbered companies without phone",
    audit.numbered_companies_without_phone,
    args.topN,
  );
  printAuditDetail(
    "Trusts / fiducies without phone",
    audit.trusts_without_phone,
    args.topN,
  );
  printAuditDetail(
    "Companies with mailing address but no phone",
    audit.companies_with_mailing_no_phone,
    args.topN,
  );

  console.log("");
  console.log(`=== Suspicious / classification flags (${audit.suspicious.length}) ===`);
  if (!audit.suspicious.length) {
    console.log("  (none)");
  } else {
    // Group by kind.
    const byKind = {};
    for (const s of audit.suspicious) {
      (byKind[s.kind] = byKind[s.kind] || []).push(s);
    }
    for (const [kind, entries] of Object.entries(byKind)) {
      console.log(`  · ${kind}: ${entries.length}`);
      entries.slice(0, 5).forEach((e) => {
        console.log(`      - ${e.package.lead_owner_name || "(no name)"} — ${e.detail}`);
      });
      if (entries.length > 5) console.log(`      … +${entries.length - 5} more`);
    }
  }

  // ─ CSV output (gitignored) ─
  if (args.csv) {
    const tmpDir = path.join(REPO_ROOT, "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    const ownersCsv = path.join(tmpDir, "owners_extracted.csv");
    const leadsCsv = path.join(tmpDir, "leads.csv");
    const ownerHeaders = [
      "owner_id", "owner_key", "display_name", "aliases", "contact_names",
      "mailing_street", "mailing_city", "mailing_province", "mailing_postal_code",
      "properties", "total_units", "phones", "emails", "websites",
      "candidate_phones", "candidate_emails", "candidate_websites", "lookup_status",
    ];
    const leadHeaders = [
      "lead_id", "owner_ids", "address", "city", "province", "postal_code", "matricule",
      "units", "utilisation", "assessment", "year_built",
      "phone", "email", "website", "phones", "emails", "websites",
      "candidate_phones", "candidate_emails", "candidate_websites", "lookup_status",
    ];
    writeCsv(ownersCsv, ownerHeaders, allOwners.map(ownerToCsvRow));
    writeCsv(leadsCsv, leadHeaders, leads.map(leadToCsvRow));
    console.log("");
    console.log("=== CSV output (gitignored) ===");
    console.log(`  ${path.relative(process.cwd(), ownersCsv)}  (${allOwners.length} rows)`);
    console.log(`  ${path.relative(process.cwd(), leadsCsv)}  (${leads.length} rows)`);
  }
}

main();
