import { parseCSV, isSpreadsheetFile } from "./tableImport.js";

// Delimiter-detection heuristics: semicolon wins when it's the dominant
// separator (French Excel), tab when it beats comma, else comma. These
// tests pin the three branches to avoid regressions if someone "simplifies"
// the detection later.

describe("parseCSV", () => {
  test("returns empty shape for null/undefined/empty input", () => {
    expect(parseCSV(null)).toEqual({ headers: [], rows: [] });
    expect(parseCSV(undefined)).toEqual({ headers: [], rows: [] });
    expect(parseCSV("")).toEqual({ headers: [], rows: [] });
    expect(parseCSV("   \n  ")).toEqual({ headers: [], rows: [] });
  });

  test("parses a simple comma-separated file", () => {
    const out = parseCSV("name,city\nJean,Montreal\nLouise,Laval");
    expect(out.delim).toBe(",");
    expect(out.headers).toEqual(["name", "city"]);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toEqual({ name: "Jean", city: "Montreal" });
    expect(out.rows[1]).toEqual({ name: "Louise", city: "Laval" });
  });

  test("auto-detects semicolon for French Excel exports", () => {
    const out = parseCSV("nom;ville;tél\nJean;Montréal;5147771234");
    expect(out.delim).toBe(";");
    expect(out.rows[0]).toEqual({
      "nom": "Jean",
      "ville": "Montréal",
      "tél": "5147771234",
    });
  });

  test("auto-detects tab for TSV input", () => {
    const out = parseCSV("a\tb\tc\n1\t2\t3");
    expect(out.delim).toBe("\t");
    expect(out.rows[0]).toEqual({ a: "1", b: "2", c: "3" });
  });

  test("respects quoted fields containing delimiter", () => {
    const out = parseCSV("name,addr\n\"Doe, Jean\",\"1 Main St, Apt 2\"");
    expect(out.rows[0]).toEqual({ name: "Doe, Jean", addr: "1 Main St, Apt 2" });
  });

  test("drops empty lines between rows", () => {
    const out = parseCSV("a,b\n1,2\n\n3,4\n\n");
    expect(out.rows).toHaveLength(2);
  });

  test("pads missing trailing cells with empty string", () => {
    const out = parseCSV("a,b,c\n1,2");
    expect(out.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("isSpreadsheetFile", () => {
  test("matches .xlsx by extension", () => {
    expect(isSpreadsheetFile({ name: "leads.xlsx", type: "" })).toBe(true);
    expect(isSpreadsheetFile({ name: "LEADS.XLSX", type: "" })).toBe(true);
  });

  test("matches .xls by extension", () => {
    expect(isSpreadsheetFile({ name: "old.xls", type: "" })).toBe(true);
  });

  test("matches by spreadsheetml MIME even without extension", () => {
    expect(
      isSpreadsheetFile({
        name: "data",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe(true);
  });

  test("rejects plain .csv", () => {
    expect(isSpreadsheetFile({ name: "data.csv", type: "text/csv" })).toBe(false);
  });

  test("handles null / missing file gracefully", () => {
    expect(isSpreadsheetFile(null)).toBe(false);
    expect(isSpreadsheetFile(undefined)).toBe(false);
    expect(isSpreadsheetFile({})).toBe(false);
  });
});
