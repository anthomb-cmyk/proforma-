import {
  looksLikeAddressText,
  hasCompanyNameHints,
  isLikelyPersonalLookupName,
  sanitizeBusinessLookupName,
  firstBusinessLookupName,
} from "./businessName.js";

describe("looksLikeAddressText", () => {
  test("detects civic+street", () => {
    expect(looksLikeAddressText("123 rue Saint-Denis")).toBe(true);
    expect(looksLikeAddressText("4500 Avenue des Pins")).toBe(true);
    expect(looksLikeAddressText("1600 Pennsylvania Avenue")).toBe(true);
    expect(looksLikeAddressText("85 Chemin du Lac")).toBe(true);
  });

  test("rejects text without digits", () => {
    expect(looksLikeAddressText("rue Saint-Denis")).toBe(false);
  });

  test("rejects text without street hint", () => {
    expect(looksLikeAddressText("123456")).toBe(false);
    expect(looksLikeAddressText("Jean Tremblay")).toBe(false);
  });

  test("handles empty/null", () => {
    expect(looksLikeAddressText("")).toBe(false);
    expect(looksLikeAddressText(null)).toBe(false);
  });
});

describe("hasCompanyNameHints", () => {
  test("recognizes common business suffixes", () => {
    expect(hasCompanyNameHints("Dubois Immobilier Inc")).toBe(true);
    expect(hasCompanyNameHints("ACME Corp")).toBe(true);
    expect(hasCompanyNameHints("Gestion XYZ Ltée")).toBe(true);
    expect(hasCompanyNameHints("Café Central")).toBe(true);
  });

  test("rejects plain personal names", () => {
    expect(hasCompanyNameHints("Jean Tremblay")).toBe(false);
    expect(hasCompanyNameHints("Marie-Claire Dubois")).toBe(false);
  });
});

describe("isLikelyPersonalLookupName", () => {
  test("detects French and English person names", () => {
    expect(isLikelyPersonalLookupName("Jean Tremblay")).toBe(true);
    expect(isLikelyPersonalLookupName("Marie Dubois")).toBe(true);
    expect(isLikelyPersonalLookupName("John Smith")).toBe(true);
  });

  test("handles French joiners", () => {
    expect(isLikelyPersonalLookupName("Jean de la Fontaine")).toBe(true);
  });

  test("rejects company-looking names", () => {
    expect(isLikelyPersonalLookupName("Tremblay Immobilier Inc")).toBe(false);
    expect(isLikelyPersonalLookupName("ACME Corp")).toBe(false);
  });

  test("rejects addresses", () => {
    expect(isLikelyPersonalLookupName("123 rue Saint-Denis")).toBe(false);
  });

  test("rejects single words", () => {
    expect(isLikelyPersonalLookupName("Tremblay")).toBe(false);
  });

  test("rejects text with digits or special chars", () => {
    expect(isLikelyPersonalLookupName("Jean 2 Tremblay")).toBe(false);
    expect(isLikelyPersonalLookupName("Jean & Marie")).toBe(false);
    expect(isLikelyPersonalLookupName("jean@mail.com")).toBe(false);
  });

  test("handles empty/null", () => {
    expect(isLikelyPersonalLookupName("")).toBe(false);
    expect(isLikelyPersonalLookupName(null)).toBe(false);
  });
});

describe("sanitizeBusinessLookupName", () => {
  test("passes through company names", () => {
    expect(sanitizeBusinessLookupName("Dubois Immobilier Inc")).toBe("Dubois Immobilier Inc");
  });

  test("drops addresses", () => {
    expect(sanitizeBusinessLookupName("123 rue Saint-Denis")).toBe("");
  });

  test("drops phone-only strings", () => {
    expect(sanitizeBusinessLookupName("(514) 555-1234")).toBe("");
  });

  test("drops email-only strings", () => {
    expect(sanitizeBusinessLookupName("jean@example.com")).toBe("");
  });

  test("drops personal names", () => {
    expect(sanitizeBusinessLookupName("Jean Tremblay")).toBe("");
  });

  test("handles empty/null", () => {
    expect(sanitizeBusinessLookupName("")).toBe("");
    expect(sanitizeBusinessLookupName(null)).toBe("");
    expect(sanitizeBusinessLookupName(undefined)).toBe("");
  });
});

describe("firstBusinessLookupName", () => {
  test("returns first usable value in order", () => {
    expect(firstBusinessLookupName("Jean Tremblay", "ACME Inc", "fallback")).toBe("ACME Inc");
  });

  test("returns empty string when nothing usable", () => {
    expect(firstBusinessLookupName("Jean Tremblay", "123 rue Saint-Denis", "")).toBe("");
  });

  test("returns empty with no args", () => {
    expect(firstBusinessLookupName()).toBe("");
  });
});
