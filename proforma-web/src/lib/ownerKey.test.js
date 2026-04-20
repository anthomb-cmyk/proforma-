import { normalizeStreet, normalizePostal, ownerKey, describeOwnerKey } from "./ownerKey.js";

describe("normalizeStreet", () => {
  test("returns empty string for empty / null / whitespace", () => {
    expect(normalizeStreet("")).toBe("");
    expect(normalizeStreet(null)).toBe("");
    expect(normalizeStreet(undefined)).toBe("");
    expect(normalizeStreet("   ")).toBe("");
  });

  test("lowercases and strips accents", () => {
    expect(normalizeStreet("Boulevard René-Lévesque")).toBe("rene levesque");
    expect(normalizeStreet("Côte-des-Neiges")).toBe("cote des neiges");
  });

  test("expands Ste- / St-", () => {
    expect(normalizeStreet("217 Ste-Catherine")).toBe("217 sainte catherine");
    expect(normalizeStreet("217 St-Jacques")).toBe("217 saint jacques");
    expect(normalizeStreet("Ste Thérèse")).toBe("sainte therese");
    expect(normalizeStreet("St. Laurent")).toBe("saint laurent");
  });

  test("strips street-type words (rue, avenue, boulevard, …)", () => {
    expect(normalizeStreet("217 rue Saint-Jacques")).toBe("217 saint jacques");
    expect(normalizeStreet("4000 avenue du Parc")).toBe("4000 du parc");
    expect(normalizeStreet("1000 Boulevard de Maisonneuve")).toBe("1000 de maisonneuve");
    expect(normalizeStreet("12 Chemin de la Côte")).toBe("12 de la cote");
  });

  test("handles English street types", () => {
    expect(normalizeStreet("123 Main Street")).toBe("123 main");
    expect(normalizeStreet("123 Main St.")).toBe("123 main");
    expect(normalizeStreet("5 Fifth Avenue")).toBe("5 fifth");
  });

  test("core dedup case: numbered-company duplicates collapse", () => {
    const a = normalizeStreet("217 Saint-Jacques");
    const b = normalizeStreet("217 rue Saint-Jacques");
    const c = normalizeStreet("217 St-Jacques");
    const d = normalizeStreet("217, Rue Saint-Jacques ");
    expect(a).toBe("217 saint jacques");
    expect(b).toBe("217 saint jacques");
    expect(c).toBe("217 saint jacques");
    expect(d).toBe("217 saint jacques");
  });

  test("strips apt/suite/unit markers + their numbers", () => {
    expect(normalizeStreet("217 rue Saint-Jacques app. 3")).toBe("217 saint jacques");
    expect(normalizeStreet("217 Saint-Jacques apt 5B")).toBe("217 saint jacques");
    expect(normalizeStreet("217 Saint-Jacques Suite 204")).toBe("217 saint jacques");
    expect(normalizeStreet("217 Saint-Jacques bureau 4")).toBe("217 saint jacques");
    expect(normalizeStreet("217 Saint-Jacques #12")).toBe("217 saint jacques");
  });

  test("punctuation collapses to spaces, not deletions", () => {
    // "217-Saint" must keep the boundary, not become "217saint"
    expect(normalizeStreet("217-Saint-Jacques")).toBe("217 saint jacques");
    expect(normalizeStreet("1 Place Ville-Marie")).toBe("1 ville marie");
  });

  test("idempotent", () => {
    const once = normalizeStreet("217, Rue Sainte-Catherine Ouest app. 12");
    const twice = normalizeStreet(once);
    expect(twice).toBe(once);
  });

  test("tolerates non-string input", () => {
    expect(normalizeStreet(217)).toBe("217");
    expect(normalizeStreet({})).toBe("object object"); // garbage in → non-crashing out
  });
});

describe("normalizePostal", () => {
  test("strips spaces + lowercases valid Canadian postal code", () => {
    expect(normalizePostal("H2Y 1M6")).toBe("h2y1m6");
    expect(normalizePostal("h2y1m6")).toBe("h2y1m6");
    expect(normalizePostal("H2Y  1M6")).toBe("h2y1m6");
    expect(normalizePostal(" H2Y1M6 ")).toBe("h2y1m6");
  });

  test("rejects invalid shapes", () => {
    expect(normalizePostal("12345")).toBe("");
    expect(normalizePostal("H2Y 1M")).toBe("");
    expect(normalizePostal("H2Y-1M6")).toBe("");
    expect(normalizePostal("")).toBe("");
    expect(normalizePostal(null)).toBe("");
    expect(normalizePostal(undefined)).toBe("");
  });
});

describe("ownerKey", () => {
  test("three numbered companies at the same address share a key", () => {
    const k1 = ownerKey("217 Saint-Jacques", "H2Y 1M6");
    const k2 = ownerKey("217 rue Saint-Jacques", "H2Y1M6");
    const k3 = ownerKey("217 St-Jacques app. 3", "h2y 1m6");
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
    expect(k1).toBe("217 saint jacques|h2y1m6");
  });

  test("same street number on different streets does NOT collapse", () => {
    const k1 = ownerKey("217 Saint-Jacques", "H2Y 1M6");
    const k2 = ownerKey("217 Sainte-Catherine", "H2X 3S6");
    expect(k1).not.toBe(k2);
  });

  test("same street in different cities disambiguates by postal", () => {
    const k1 = ownerKey("217 Saint-Jacques", "H2Y 1M6"); // Montréal
    const k2 = ownerKey("217 Saint-Jacques", "G1R 2K7"); // Québec
    expect(k1).not.toBe(k2);
  });

  test("empty address + empty postal yields no key", () => {
    expect(ownerKey("", "")).toBe("");
    expect(ownerKey(null, null)).toBe("");
  });

  test("street without postal still produces a key (weaker)", () => {
    expect(ownerKey("217 Saint-Jacques", "")).toBe("217 saint jacques|");
  });
});

describe("describeOwnerKey", () => {
  test("formats street + postal for display", () => {
    expect(describeOwnerKey("217 saint jacques|h2y1m6")).toBe("217 saint jacques (H2Y1M6)");
  });

  test("handles postal-only key", () => {
    expect(describeOwnerKey("|h2y1m6")).toBe("H2Y1M6");
  });

  test("handles street-only key", () => {
    expect(describeOwnerKey("217 saint jacques|")).toBe("217 saint jacques");
  });

  test("empty / invalid input", () => {
    expect(describeOwnerKey("")).toBe("");
    expect(describeOwnerKey(null)).toBe("");
  });
});
