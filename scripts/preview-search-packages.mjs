#!/usr/bin/env node
// preview-search-packages.mjs
//
// Offline dev preview for the canonical owner/entity search package builder.
// Reads a JSON fixture (owner-shaped or lead-like rows), runs them through
// buildSearchPackages, and prints a stats header + top-20 package rows.
//
// Usage:
//   node scripts/preview-search-packages.mjs [path/to/fixture.json] [topN]
//
// Defaults:
//   path  = scripts/sample-fixtures/owners.sample.json
//   topN  = 20
//
// JSON shape — any of the following work:
//   • { "owners": [ {...Owner}, ... ] }
//   • { "rows":   [ {...Lead}, ... ] }
//   • [ {...}, ... ]                        // flat array
//
// No network calls. No Google Places. Read-only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSearchPackages,
  formatSearchPackageReport,
} from "../proforma-web/src/lib/searchPackage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadInput(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath} as JSON: ${err.message}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.owners)) return parsed.owners;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.leads)) return parsed.leads;
  throw new Error(
    `${filePath} must contain an array, or an object with an "owners" / "rows" / "leads" array`,
  );
}

function main() {
  const argFile = process.argv[2];
  const argTopN = process.argv[3];
  const defaultFixture = path.join(__dirname, "sample-fixtures", "owners.sample.json");
  const filePath = argFile || defaultFixture;
  const topN = argTopN != null ? Number(argTopN) : 20;

  if (!fs.existsSync(filePath)) {
    console.error(`Fixture not found: ${filePath}`);
    process.exit(1);
  }

  const rows = loadInput(filePath);
  const packages = buildSearchPackages(rows);
  const report = formatSearchPackageReport(packages, { topN });

  console.log(`# preview-search-packages`);
  console.log(`# source: ${path.relative(process.cwd(), filePath)}`);
  console.log(`# input rows: ${rows.length}`);
  console.log("");
  console.log(report);
}

main();
