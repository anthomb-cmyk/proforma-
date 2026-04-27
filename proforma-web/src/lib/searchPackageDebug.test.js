import {
  isSearchPackageDebugEnabled,
  buildSearchPackagePreviewData,
} from "./searchPackageDebug.js";
import { makePhoneCandidate } from "./contactCandidates.js";

// localStorage shim is provided by jsdom (CRA test env) — no setup needed.

describe("isSearchPackageDebugEnabled", () => {
  beforeEach(() => {
    try { localStorage.removeItem("pf_spdebug"); } catch {}
  });

  test("returns false when flag is unset", () => {
    expect(isSearchPackageDebugEnabled()).toBe(false);
  });

  test("returns true when flag is '1'", () => {
    localStorage.setItem("pf_spdebug", "1");
    expect(isSearchPackageDebugEnabled()).toBe(true);
  });

  test("returns false for any other value", () => {
    localStorage.setItem("pf_spdebug", "0");
    expect(isSearchPackageDebugEnabled()).toBe(false);
    localStorage.setItem("pf_spdebug", "true");
    expect(isSearchPackageDebugEnabled()).toBe(false);
  });

  test("returns false when localStorage throws", () => {
    const original = global.localStorage;
    Object.defineProperty(global, "localStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    try {
      expect(isSearchPackageDebugEnabled()).toBe(false);
    } finally {
      Object.defineProperty(global, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("buildSearchPackagePreviewData", () => {
  // Synthetic lead-like rows mirroring the shape PhoneFinder feeds in.
  function fixture() {
    const fileOwnerCand = makePhoneCandidate({
      phone: "514-555-0142", source: "file", source_column: "Téléphone Propriétaire",
      relationship_to_lead_owner: "owner",
    });
    return [
      // Has owner-direct file phone → use_file_phone, low search need.
      {
        companyName: "ABC Immobilier Inc.",
        address: "100 Elm", city: "Longueuil", postalCode: "J4K 1A1",
        mailing_address: "217 Saint-Jacques", mailing_city: "Montréal",
        mailing_province: "QC", mailing_postal_code: "H2Y 1M6",
        units: 12,
        phone: "(514) 555-0142", phones: ["(514) 555-0142"],
        candidatePhones: [fileOwnerCand],
      },
      // Numbered company without phone — should land in the audit bucket.
      {
        companyName: "9338-8387 QUEBEC INC.",
        address: "400 Cedar", city: "Longueuil",
        mailing_address: "1500 Industriel", mailing_city: "Boucherville",
        mailing_province: "QC", mailing_postal_code: "J4B 7K6",
        units: 16,
        phones: [],
      },
      // Trust without phone.
      {
        companyName: "Fiducie Famille Bouchard",
        address: "500 Birch", city: "Longueuil",
        mailing_address: "880 Fiducie", mailing_city: "Saint-Lambert",
        mailing_province: "QC", mailing_postal_code: "J4P 1A1",
        units: 10,
        phones: [],
      },
      // High-value individual: 3 rows, same mailing → grouped, no phone.
      ...["A", "B", "C"].map((s, i) => ({
        companyName: "Jean Tremblay",
        address: `70${i} Spruce`, city: "Longueuil",
        mailing_address: "55 Pionniers", mailing_city: "Longueuil",
        mailing_province: "QC", mailing_postal_code: "J4M 2N3",
        units: 6 + i,
        phones: [],
      })),
    ];
  }

  test("returns expected aggregate counts", () => {
    const data = buildSearchPackagePreviewData(fixture());
    expect(data.inputRowCount).toBe(6);
    // 3 rows for Jean Tremblay collapse → 4 packages total.
    expect(data.packageCount).toBe(4);
    expect(data.withPhone).toBe(1);
    expect(data.withoutPhone).toBe(3);
    expect(data.withOwnerFilePhone).toBe(1);
    expect(data.numberedCompanies).toBe(1);
    expect(data.trusts).toBe(1);
    expect(data.individuals).toBe(1);
    expect(data.withMailingAddress).toBe(4);
  });

  test("lead_value + search_need breakdowns add up to packageCount", () => {
    const data = buildSearchPackagePreviewData(fixture());
    const lvSum = data.leadValue.high + data.leadValue.medium + data.leadValue.low;
    const snSum = data.searchNeed.high + data.searchNeed.medium + data.searchNeed.low + data.searchNeed.skip;
    expect(lvSum).toBe(data.packageCount);
    expect(snSum).toBe(data.packageCount);
  });

  test("topHighValueWithoutPhone is sorted by portfolio + carries display fields", () => {
    const data = buildSearchPackagePreviewData(fixture());
    const top = data.topHighValueWithoutPhone;
    expect(top.length).toBeGreaterThan(0);
    // Jean Tremblay (3 properties) should be first.
    expect(top[0].name).toBe("Jean Tremblay");
    expect(top[0].properties).toBe(3);
    // Each row carries the fields the panel renders.
    for (const r of top) {
      expect(typeof r.name).toBe("string");
      expect(typeof r.category).toBe("string");
      expect(["high", "medium", "low"]).toContain(r.leadValue);
      expect(["high", "medium", "low", "skip"]).toContain(r.searchNeed);
      expect(typeof r.strategy).toBe("string");
      expect(typeof r.properties).toBe("number");
      expect(typeof r.units).toBe("number");
      expect(typeof r.summary).toBe("string");
    }
  });

  test("targeted-audit lists are exposed", () => {
    const data = buildSearchPackagePreviewData(fixture());
    expect(data.numberedCompaniesWithoutPhone.map((p) => p.lead_owner_name))
      .toEqual(["9338-8387 QUEBEC INC."]);
    expect(data.trustsWithoutPhone.map((p) => p.lead_owner_name))
      .toEqual(["Fiducie Famille Bouchard"]);
  });

  test("topN option caps the top high-value list", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      companyName: `ABC Immobilier ${i} Inc.`,
      address: `${i} Elm`, city: "Longueuil",
      mailing_address: `${i} Mailing`, mailing_city: "Montréal",
      mailing_province: "QC", mailing_postal_code: `H2Y ${i}A1`,
      units: 12,
      phones: [],
    }));
    const data = buildSearchPackagePreviewData(rows, { topN: 5 });
    expect(data.topHighValueWithoutPhone).toHaveLength(5);
  });

  test("empty / null input returns zero counts and empty lists", () => {
    const empty = buildSearchPackagePreviewData([]);
    expect(empty.inputRowCount).toBe(0);
    expect(empty.packageCount).toBe(0);
    expect(empty.withPhone).toBe(0);
    expect(empty.topHighValueWithoutPhone).toEqual([]);
    const nullData = buildSearchPackagePreviewData(null);
    expect(nullData.packageCount).toBe(0);
  });
});
