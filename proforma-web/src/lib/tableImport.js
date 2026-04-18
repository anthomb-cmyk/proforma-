// Shared CSV / XLSX parsing for the two import flows (LeadsManager and
// PhoneFinder). Both pages used to carry duplicated implementations that
// only differed in cosmetic ways — consolidated here so:
//   1. Delimiter auto-detection is tuned in one place (semicolon-first for
//      French Excel exports, tab for TSV, then comma).
//   2. Quoted-field handling stays consistent across both pages.
//   3. Column dedupe on Excel imports ("Colonne 1", "Colonne 1 (2)") has
//      one canonical algorithm.
//
// parseSpreadsheet() reads window.XLSX (injected via <script> in public/)
// so this module stays zero-dep. If a bundler build of SheetJS is added,
// the getter can swap to a real `import`.

// Parses a CSV/TSV/SSV blob into { headers, rows, delim }.
//   - `rows` are plain objects keyed by header name.
//   - `delim` is the detected separator (useful for the column-map preview).
// Returns { headers: [], rows: [] } for empty input.
export function parseCSV(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (!lines.length || !lines[0]) return { headers: [], rows: [] };

  // Auto-detect delimiter: semicolon (French Excel) > tab > comma. We count
  // occurrences on the header row because it's the most likely to be
  // delimited consistently. Ties favor semicolon then tab then comma.
  const first = lines[0];
  const counts = {
    ",": (first.match(/,/g) || []).length,
    ";": (first.match(/;/g) || []).length,
    "\t": (first.match(/\t/g) || []).length,
  };
  const delim =
    counts[";"] >= counts[","] && counts[";"] >= counts["\t"]
      ? ";"
      : counts["\t"] >= counts[","]
        ? "\t"
        : ",";

  // Minimal RFC-ish parser: tracks quoted state so commas inside "a,b" stay
  // in one cell. Does NOT handle escaped quotes ("") because the current
  // input sources (Excel & Google Sheets exports) don't emit them for the
  // fields we read; upgrade to a full parser only if that becomes false.
  const parseLine = (line) => {
    const res = [];
    let cur = "";
    let inQ = false;
    for (const c of line) {
      if (c === "\"") { inQ = !inQ; continue; }
      if (c === delim && !inQ) { res.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    res.push(cur.trim());
    return res;
  };

  const headers = parseLine(lines[0]);
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const vals = parseLine(l);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
    });
  return { headers, rows, delim };
}

// Reads an .xlsx/.xls File and resolves to { headers, rows, delim } where
// `delim` carries the sheet name for display (e.g. "XLSX · Feuil1"). Pulls
// SheetJS from window.XLSX (loaded by the host page); rejects if missing.
//
// Empty rows are dropped; header dedupe appends " (2)", " (3)" etc so
// Object.fromEntries doesn't collapse duplicate columns.
export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const XLSX = typeof window !== "undefined" ? window.XLSX : null;
    if (!XLSX) {
      reject(new Error("Module Excel non chargé."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) throw new Error("Aucune feuille trouvée.");
        const matrix = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], {
          header: 1,
          defval: "",
        });
        if (!Array.isArray(matrix) || !matrix.length) {
          throw new Error("Le fichier est vide.");
        }
        const rawHeaders = Array.isArray(matrix[0]) ? matrix[0] : [];
        const dedupe = {};
        const headers = rawHeaders.map((h, i) => {
          let base = String(h || `Colonne ${i + 1}`).trim();
          if (!base) base = `Colonne ${i + 1}`;
          const seen = dedupe[base] || 0;
          dedupe[base] = seen + 1;
          return seen ? `${base} (${seen + 1})` : base;
        });
        const rows = matrix
          .slice(1)
          .map((vals) =>
            Object.fromEntries(
              headers.map((h, i) => [h, String(vals?.[i] ?? "").trim()]),
            ),
          )
          .filter((row) => Object.values(row).some((v) => String(v).trim()));
        resolve({ headers, rows, delim: `XLSX · ${firstSheet}` });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Canonicalizes header strings for fuzzy auto-detect matching.
// Lowercases, strips accents, collapses non-alphanumerics to single spaces.
// Used by both pages' column auto-detect patterns (the pattern lists differ —
// leads need building/assessment/units columns; PhoneFinder needs company/
// lookup-name columns — but the normalization is shared).
export function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Boolean check used by the UI to pick parseCSV vs parseSpreadsheet.
// Extension trumps MIME since browsers return blank MIME for many drops.
export function isSpreadsheetFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return (
    /\.xlsx?$/.test(name) ||
    type.includes("spreadsheetml") ||
    type.includes("excel")
  );
}
