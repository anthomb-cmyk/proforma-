// proforma-web/src/lib/ownerDeduplication.test.js

import {
  normalizeOwnerKey,
  normalizeAddressKey,
  groupKey,
  groupPackagesByOwner,
  fanOutResult,
} from "./ownerDeduplication.js";

describe("normalizeOwnerKey", () => {
  // 1. Corporate suffix stripped
  test('strips corporate suffix: "GESTION IMMOBILIÈRE CHOINIÈRE INC." → "gestion immobiliere choiniere"', () => {
    expect(normalizeOwnerKey("GESTION IMMOBILIÈRE CHOINIÈRE INC.")).toBe("gestion immobiliere choiniere");
  });

  // 2. Same owner with/without accents → same key
  test("accented vs non-accented owner produces the same key", () => {
    const a = normalizeOwnerKey("Gestion Immobilière Choinière Inc.");
    const b = normalizeOwnerKey("Gestion Immobiliere Choiniere Inc.");
    expect(a).toBe(b);
  });

  test("various suffixes are stripped: ltée, ltee, llc, llp, corp, ltd", () => {
    expect(normalizeOwnerKey("ABC CORP.")).toBe("abc");
    expect(normalizeOwnerKey("DEF LLC")).toBe("def");
    expect(normalizeOwnerKey("GHI LTD")).toBe("ghi");
    expect(normalizeOwnerKey("JKL LTÉE")).toBe("jkl");
  });

  test("empty/null input returns empty string", () => {
    expect(normalizeOwnerKey("")).toBe("");
    expect(normalizeOwnerKey(null)).toBe("");
    expect(normalizeOwnerKey(undefined)).toBe("");
  });
});

describe("normalizeAddressKey", () => {
  test("uses postal code when present", () => {
    const key = normalizeAddressKey({ street: "123 Main St", city: "Montreal", postalCode: "H2X 1Y3" });
    expect(key).toBe("pc:h2x1y3");
  });

  test("falls back to street+city when postalCode is empty", () => {
    const key = normalizeAddressKey({ street: "123 Main St", city: "Montreal", postalCode: "" });
    expect(key).toBe("addr:123mainst|montreal");
  });

  test("strips diacritics from address parts", () => {
    const key = normalizeAddressKey({ street: "Rue de l'Église", city: "Québec" });
    expect(key).toContain("quebec");
  });

  test("handles missing fields gracefully", () => {
    const key = normalizeAddressKey({});
    expect(typeof key).toBe("string");
  });
});

describe("groupPackagesByOwner", () => {
  const makeEntry = (packageKey, pkg) => ({ packageKey, package: pkg });

  // 3. Two packages with same owner+address → grouped together; ONE representative
  test("two packages with same owner+address → one group with one representative", () => {
    const entries = [
      makeEntry("p1", { lead_owner_name: "Test Corp Inc.", mailing_address: "100 Main", mailing_city: "Montreal", postal_code: "H1A1A1" }),
      makeEntry("p2", { lead_owner_name: "TEST CORP INC", mailing_address: "200 Side", mailing_city: "Montreal", postal_code: "H1A1A1" }),
    ];

    const { groups, representatives } = groupPackagesByOwner(entries);

    expect(groups.size).toBe(1);
    expect(representatives).toHaveLength(1);
    expect(representatives[0].packageKey).toBe("p1");
    const groupEntries = [...groups.values()][0];
    expect(groupEntries).toHaveLength(2);
  });

  // 4. Two packages with same owner but different addresses → DIFFERENT groups
  test("same owner but different postal codes → two separate groups", () => {
    const entries = [
      makeEntry("p1", { lead_owner_name: "Test Corp Inc.", postal_code: "H1A1A1" }),
      makeEntry("p2", { lead_owner_name: "TEST CORP INC", postal_code: "H2B2B2" }),
    ];

    const { groups, representatives } = groupPackagesByOwner(entries);

    expect(groups.size).toBe(2);
    expect(representatives).toHaveLength(2);
  });

  test("handles empty packages array", () => {
    const { groups, representatives } = groupPackagesByOwner([]);
    expect(groups.size).toBe(0);
    expect(representatives).toHaveLength(0);
  });
});

describe("fanOutResult", () => {
  const makeEntry = (key, extra = {}) => ({
    packageKey: key,
    package: { lead_owner_name: "Test Owner", propertyId: `prop_${key}`, address: `addr_${key}`, units: 10 + key.length, ...extra },
  });

  // 5. fanOutResult preserves per-member propertyId/address but shares owner-side fields
  test("representative gets result as-is; members get property fields from their own package", () => {
    const representative = makeEntry("rep");
    const member1 = makeEntry("m1");
    const member2 = makeEntry("m2");
    const group = [representative, member1, member2];

    const result = {
      lead_owner_name: "Test Owner",
      bestPhone: "514-555-1234",
      bestEmail: "test@example.com",
      status: "ready_to_call",
      evidence: ["phone_found"],
    };

    const fanOut = fanOutResult(result, group);

    expect(fanOut.size).toBe(3);

    // Representative: unchanged result
    const repResult = fanOut.get("rep");
    expect(repResult.bestPhone).toBe("514-555-1234");
    expect(repResult.evidence).toEqual(["phone_found"]);

    // Member 1: shares owner-side fields, gets its own property fields
    const m1Result = fanOut.get("m1");
    expect(m1Result.bestPhone).toBe("514-555-1234"); // shared
    expect(m1Result.propertyId).toBe("prop_m1");    // member's own property
    expect(m1Result.address).toBe("addr_m1");        // member's own address
    expect(m1Result.evidence).toContain("deduped_from_representative: rep");

    // Member 2: same pattern
    const m2Result = fanOut.get("m2");
    expect(m2Result.bestPhone).toBe("514-555-1234"); // shared
    expect(m2Result.propertyId).toBe("prop_m2");
    expect(m2Result.evidence).toContain("deduped_from_representative: rep");
  });

  test("fanOutResult with single-member group (just representative)", () => {
    const group = [makeEntry("solo")];
    const result = { bestPhone: "555-0000", status: "ready_to_call" };
    const fanOut = fanOutResult(result, group);
    expect(fanOut.size).toBe(1);
    expect(fanOut.get("solo").bestPhone).toBe("555-0000");
  });
});
