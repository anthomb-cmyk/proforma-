/**
 * buildingCity.test.js
 *
 * Tests for pickBuildingCityFromRawRow and extractCityFromAddress.
 * Verifies that Format D "Ville_code_postal_proprio" (owner postal city)
 * is never returned as the building city.
 */

import { pickBuildingCityFromRawRow, extractCityFromAddress } from "./buildingCity.js";

// ── pickBuildingCityFromRawRow ─────────────────────────────────────────────

describe("pickBuildingCityFromRawRow", () => {
  test("picks 'Ville (immeuble)' when present", () => {
    expect(pickBuildingCityFromRawRow({ "Ville (immeuble)": "Granby" })).toBe("Granby");
  });

  test("picks 'Ville1' over Ville_code_postal_proprio", () => {
    const row = { Ville1: "Granby", Ville_code_postal_proprio: "Montréal" };
    expect(pickBuildingCityFromRawRow(row)).toBe("Granby");
  });

  test("explicitly ignores Ville_code_postal_proprio when no other Ville column", () => {
    expect(pickBuildingCityFromRawRow({ Ville_code_postal_proprio: "Montréal" })).toBe("");
  });

  test("fallback picks any non-proprio ville column", () => {
    expect(pickBuildingCityFromRawRow({ Ville_municipale: "Trois-Rivières" })).toBe("Trois-Rivières");
  });

  test("returns empty for null/empty input", () => {
    expect(pickBuildingCityFromRawRow(null)).toBe("");
    expect(pickBuildingCityFromRawRow({})).toBe("");
  });

  test("picks plain 'Ville' column", () => {
    expect(pickBuildingCityFromRawRow({ Ville: "Sherbrooke" })).toBe("Sherbrooke");
  });

  test("picks 'Ville2' when 'Ville' is absent", () => {
    expect(pickBuildingCityFromRawRow({ Ville2: "Laval" })).toBe("Laval");
  });

  test("picks 'Ville-immeuble' variant", () => {
    expect(pickBuildingCityFromRawRow({ "Ville-immeuble": "Québec" })).toBe("Québec");
  });

  test("picks 'Ville_immeuble' variant", () => {
    expect(pickBuildingCityFromRawRow({ "Ville_immeuble": "Longueuil" })).toBe("Longueuil");
  });

  test("ignores column containing 'postal'", () => {
    expect(pickBuildingCityFromRawRow({ "Ville_postal_owner": "Montréal" })).toBe("");
  });

  test("prefers Ville (immeuble) over plain Ville when both present", () => {
    const row = { "Ville (immeuble)": "Granby", Ville: "Autre" };
    expect(pickBuildingCityFromRawRow(row)).toBe("Granby");
  });
});

// ── extractCityFromAddress ─────────────────────────────────────────────────

describe("extractCityFromAddress", () => {
  test("extracts city from typical QC address with separate segments", () => {
    expect(extractCityFromAddress("123 rue X, Granby, QC, J2G 1A1")).toBe("Granby");
  });

  test("strips trailing province from city segment", () => {
    expect(extractCityFromAddress("123 rue X, Montréal QC, H2X 1A1")).toBe("Montréal");
  });

  test("returns empty when no city segment (no comma)", () => {
    expect(extractCityFromAddress("123 rue X")).toBe("");
  });

  test("returns empty for empty string", () => {
    expect(extractCityFromAddress("")).toBe("");
  });

  test("returns empty for null", () => {
    expect(extractCityFromAddress(null)).toBe("");
  });

  test("skips postal code segments", () => {
    // If postal code appears before city, skip it and still find city
    expect(extractCityFromAddress("123 rue X, J2G 1A1, Granby, QC")).toBe("Granby");
  });

  test("handles Québec accent in province token", () => {
    expect(extractCityFromAddress("100 boul. Y, Trois-Rivières, Québec, G1R 1A1")).toBe("Trois-Rivières");
  });
});
