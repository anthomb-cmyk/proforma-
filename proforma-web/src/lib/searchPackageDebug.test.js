import {
  isSearchPackageDebugEnabled,
  buildSearchPackagePreviewData,
} from "./searchPackageDebug.js";
import { makePhoneCandidate } from "./contactCandidates.js";

// Helper used by the raw rôle tests below.
// Produces a flat row object whose keys mirror real Québec rôle column
// headers. All omitted fields default to "" so the headers array derived
// from Object.keys() is always the same shape regardless of which
// overrides are provided.
function makeRoleRow(overrides = {}) {
  return {
    "Propriétaire": "",
    "Propriétaire Prénom": "",
    "Propriétaire Nom": "",
    "Statut aux fins d'imposition scolaire": "",
    "Adresse postale": "",
    "Téléphone": "",
    "Propriétaire 2": "",
    "Propriétaire 2 Prénom": "",
    "Propriétaire 2 Nom": "",
    "Statut aux fins d'imposition scolaire 2": "",
    "Adresse postale 2": "",
    "Téléphone 2": "",
    "Adresse Immeuble": "999 rue Fictive",   // non-empty prevents row skip
    "Téléphone Immeuble": "",
    "Valeur de l'immeuble": "",
    "Numéro de matricule": "73-000-001",     // non-empty prevents row skip
    ...overrides,
  };
}

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

  test("topHighValueWithoutPhone is sorted by enrichment score and carries display fields", () => {
    const data = buildSearchPackagePreviewData(fixture());
    const top = data.topHighValueWithoutPhone;
    expect(top.length).toBeGreaterThan(0);
    // Fiducie Famille Bouchard (trust, searchability=75, lead_value=high → score=85) ranks
    // first under the new enrichment model, ahead of Jean Tremblay (individual, score=67).
    expect(top[0].name).toBe("Fiducie Famille Bouchard");
    // Each row carries the core fields the panel renders.
    for (const r of top) {
      expect(typeof r.name).toBe("string");
      expect(typeof r.category).toBe("string");
      expect(["high", "medium", "low"]).toContain(r.leadValue);
      expect(["high", "medium", "low", "skip"]).toContain(r.searchNeed);
      expect(typeof r.strategy).toBe("string");
      expect(typeof r.properties).toBe("number");
      expect(typeof r.units).toBe("number");
      expect(typeof r.summary).toBe("string");
      // New enrichment fields.
      expect(typeof r.enrichmentScore).toBe("number");
      expect(["high", "medium", "low", "skipped"]).toContain(r.enrichmentPriority);
      expect(["high", "medium", "low", "skip"]).toContain(r.searchabilityPriority);
    }
    // Scores decrease monotonically across the combined bucket list.
    for (let i = 1; i < top.length; i++) {
      expect(top[i].enrichmentScore).toBeLessThanOrEqual(top[i - 1].enrichmentScore);
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

// ─── Raw rôle-style row tests ──────────────────────────────────────────────
//
// These tests exercise the rôle-detection + adaptation path added to
// buildSearchPackagePreviewData. All rows are synthetic flat objects whose
// keys are real Québec rôle column headers — no network calls, no file I/O.

describe("buildSearchPackagePreviewData — raw rôle rows", () => {
  test("detects rôle rows and produces meaningful lead-value buckets", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Gestion Laval Inc.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "100 rue A, Laval (Québec) H7T 1A1",
        "Numéro de matricule": "73-001-001",
      }),
      makeRoleRow({
        "Propriétaire": "9338-8387 QUEBEC INC.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "200 rue B, Montréal (Québec) H2Y 1B1",
        "Numéro de matricule": "73-001-002",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.inputRowCount).toBe(2);
    expect(data.packageCount).toBeGreaterThan(0);
    // At least one searchable entity should be medium or high — not all low.
    expect(data.leadValue.medium + data.leadValue.high).toBeGreaterThan(0);
  });

  test("owner phone in Téléphone column counts as withPhone and withOwnerFilePhone", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Gestion Bolduc Inc.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "100 rue des Pins, Longueuil (Québec) J4K 1A1",
        "Téléphone": "450-555-0101",
        "Numéro de matricule": "73-002-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.withPhone).toBe(1);
    expect(data.withOwnerFilePhone).toBe(1);
    expect(data.withoutPhone).toBe(0);
  });

  test("second owner phone in Téléphone 2 column is counted as withPhone", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Gestion ABC Inc.",
        "Adresse postale": "100 rue des Pins, Longueuil (Québec) J4K 1A1",
        // slot 0 has no phone
        "Propriétaire 2": "Pierre Bolduc",
        "Statut aux fins d'imposition scolaire 2": "Personne physique",
        "Adresse postale 2": "200 chemin des Érables, Longueuil (Québec) J4H 2B2",
        "Téléphone 2": "450-555-0102",
        "Numéro de matricule": "73-003-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    // Two packages (slot 0 owner + slot 1 owner); at least one has a phone.
    expect(data.packageCount).toBe(2);
    expect(data.withPhone).toBeGreaterThanOrEqual(1);
    expect(data.withOwnerFilePhone).toBeGreaterThanOrEqual(1);
  });

  test("two owner slots on the same row produce two separate packages", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Gestion XYZ Inc.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "100 rue Gestion, Montréal (Québec) H3A 1A1",
        "Téléphone": "514-555-0101",
        "Propriétaire 2": "Luc Gagnon",
        "Statut aux fins d'imposition scolaire 2": "Personne physique",
        "Adresse postale 2": "55 Pionniers, Longueuil (Québec) J4M 1B1",
        // Téléphone 2 intentionally empty
        "Numéro de matricule": "73-004-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.packageCount).toBe(2);
    // Only the company owner has a phone (Téléphone slot 0).
    expect(data.withPhone).toBe(1);
    expect(data.withoutPhone).toBe(1);
  });

  test("same owner + same Adresse postale on two rows → single combined package", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Jean Tremblay",
        "Adresse postale": "55 Pionniers, Longueuil (Québec) J4M 2N3",
        "Adresse Immeuble": "400 rue Elm",
        "Numéro de matricule": "73-005-001",
      }),
      makeRoleRow({
        "Propriétaire": "Jean Tremblay",
        "Adresse postale": "55 Pionniers, Longueuil (Québec) J4M 2N3",
        "Adresse Immeuble": "500 rue Oak",
        "Numéro de matricule": "73-005-002",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.inputRowCount).toBe(2);
    // Same mailing address → collapsed into one owner → one package.
    expect(data.packageCount).toBe(1);
    // That one package covers both buildings.
    expect(data.totalProperties).toBe(2);
    // Same-address grouping is NOT flagged as a suspicious duplicate.
    expect(data.duplicateDifferentAddress).toBe(0);
  });

  test("same owner + different Adresse postale → two packages flagged duplicate_different_address", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Michel Lavoie",
        "Adresse postale": "10 rue A, Montréal (Québec) H1A 1A1",
        "Adresse Immeuble": "600 rue Cedar",
        "Numéro de matricule": "73-006-001",
      }),
      makeRoleRow({
        "Propriétaire": "Michel Lavoie",
        "Adresse postale": "20 rue B, Laval (Québec) H7A 2B2",
        "Adresse Immeuble": "700 rue Pine",
        "Numéro de matricule": "73-006-002",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    // Different mailing address → two separate packages.
    expect(data.packageCount).toBe(2);
    // Both are flagged as same-name-different-address.
    expect(data.duplicateDifferentAddress).toBe(2);
  });

  test("numbered company is classified and surfaced in the audit bucket", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "9338-8387 QUEBEC INC.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "1500 Industriel, Boucherville (Québec) J4B 7K6",
        "Numéro de matricule": "73-007-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.numberedCompanies).toBe(1);
    expect(data.numberedCompaniesWithoutPhone).toHaveLength(1);
    expect(data.numberedCompaniesWithoutPhone[0].lead_owner_name).toBe("9338-8387 QUEBEC INC.");
  });

  test("fiducie (trust) is classified and surfaced in the audit bucket", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Fiducie Famille Bouchard",
        "Adresse postale": "880 chemin Fiducie, Saint-Lambert (Québec) J4P 1A1",
        "Numéro de matricule": "73-008-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.trusts).toBe(1);
    expect(data.trustsWithoutPhone).toHaveLength(1);
    expect(data.trustsWithoutPhone[0].lead_owner_name).toBe("Fiducie Famille Bouchard");
  });

  test("Téléphone Immeuble goes to building relationship, not owner-direct file phone", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "ABC Gestion Inc.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "100 rue A, Montréal (Québec) H3A 1A1",
        // no Téléphone (owner phone)
        "Téléphone Immeuble": "514-555-0103",
        "Numéro de matricule": "73-009-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    // Building phone is still a valid phone → package has a phone.
    expect(data.withPhone).toBe(1);
    // But it must NOT count as an owner-direct file phone.
    expect(data.withOwnerFilePhone).toBe(0);
  });

  test("Phone Finder wrapped rows (rawRow) are detected and adapted correctly", () => {
    // Simulate how PhoneFinder.searchCSV() shapes each row before staging
    // the pendingLookup: the original Excel row is kept in `rawRow` while
    // the outer object carries the mapped/derived fields the UI uses.
    const rawRoleRow = makeRoleRow({
      "Propriétaire": "9999-1111 QUEBEC INC.",
      "Statut aux fins d'imposition scolaire": "Personne morale",
      "Adresse postale": "300 rue X, Québec (Québec) G1A 1A1",
      "Numéro de matricule": "73-010-001",
    });
    const pfWrappedRow = {
      name: "9999-1111 QUEBEC INC.",
      rawName: "9999-1111 QUEBEC INC.",
      company: "",
      leadContact: "",
      address: "300 rue X",
      city: "Québec",
      province: "Québec",
      postalCode: "G1A 1A1",
      country: "Canada",
      buildingAddress: "300 rue X, Québec, Québec, G1A 1A1",
      inputPhones: [],
      rawRow: rawRoleRow,
    };
    const data = buildSearchPackagePreviewData([pfWrappedRow]);
    expect(data.inputRowCount).toBe(1);
    // Should have reached into rawRow and produced a proper package.
    expect(data.packageCount).toBeGreaterThan(0);
    expect(data.numberedCompanies).toBe(1);
  });

  // ── Fan-out regression tests (added after observing that the previous
  //    adapter collapsed co-owners at the same address into one package) ──

  test("Propriétaire + Propriétaire 2 on one row fan out to two separate packages", () => {
    // Each slot has a distinct mailing address so they must stay separate.
    const rows = [
      makeRoleRow({
        "Propriétaire": "Gestion Fictive Inc.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "100 rue A, Longueuil (Québec) J4K 1A1",
        "Propriétaire 2": "Marie Fictive",
        "Statut aux fins d'imposition scolaire 2": "Personne physique",
        "Adresse postale 2": "200 rue B, Longueuil (Québec) J4L 2B2",
        "Numéro de matricule": "73-101-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.packageCount).toBe(2);
    // The company should be a searchable entity (medium or high lead value).
    expect(data.leadValue.medium + data.leadValue.high).toBeGreaterThan(0);
  });

  test("same owner + same mailing on two rows combines into one package with two properties", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "René Fictif",
        "Adresse postale": "55 Pionniers, Longueuil (Québec) J4M 2N3",
        "Adresse Immeuble": "400 rue Elm",
        "Numéro de matricule": "73-102-001",
      }),
      makeRoleRow({
        "Propriétaire": "René Fictif",
        "Adresse postale": "55 Pionniers, Longueuil (Québec) J4M 2N3",
        "Adresse Immeuble": "500 rue Oak",
        "Numéro de matricule": "73-102-002",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.packageCount).toBe(1);
    expect(data.totalProperties).toBe(2);
    expect(data.duplicateDifferentAddress).toBe(0);
  });

  test("same owner + different mailing on two rows stays separate and flags duplicate_different_address", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Luc Fictif",
        "Adresse postale": "10 rue X, Montréal (Québec) H1A 1A1",
        "Numéro de matricule": "73-103-001",
      }),
      makeRoleRow({
        "Propriétaire": "Luc Fictif",
        "Adresse postale": "20 rue Y, Laval (Québec) H7A 2B2",
        "Numéro de matricule": "73-103-002",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.packageCount).toBe(2);
    expect(data.duplicateDifferentAddress).toBe(2);
  });

  test("FIDUCIE in Propriétaire 2 is classified as trust even when co-owner is an individual", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "Jean Fictif",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "100 rue A, Longueuil (Québec) J4K 1A1",
        "Propriétaire 2": "FIDUCIE DE CAPITAL DU MONT",
        "Statut aux fins d'imposition scolaire 2": "Personne morale",
        "Adresse postale 2": "200 rue B, Longueuil (Québec) J4L 2B2",
        "Numéro de matricule": "73-104-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.packageCount).toBe(2);
    expect(data.trusts).toBe(1);
    expect(data.trustsWithoutPhone.map((p) => p.lead_owner_name))
      .toContain("FIDUCIE DE CAPITAL DU MONT");
  });

  test("INC company in Propriétaire 1 is classified as a searchable entity", () => {
    const rows = [
      makeRoleRow({
        "Propriétaire": "YK REALTIES INC.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "300 rue C, Longueuil (Québec) J4H 3C3",
        "Numéro de matricule": "73-105-001",
      }),
    ];
    const data = buildSearchPackagePreviewData(rows);
    expect(data.packageCount).toBe(1);
    // Must be searchable (inc_ltee) with mailing address → medium or high lead value.
    expect(data.leadValue.medium + data.leadValue.high).toBeGreaterThan(0);
    // Appears in companiesWithMailingNoPhone since it has a mailing address but no phone.
    expect(
      data.companiesWithMailingNoPhone.map((p) => p.lead_owner_name),
    ).toContain("YK REALTIES INC.");
  });
});
