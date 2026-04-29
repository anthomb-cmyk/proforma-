// proforma-web/src/lib/directImportToLeads.test.js
//
// Tests for the pure directImportToLeads helpers. No API calls, no DOM.
//
// Phone numbers used in tests are genuine NANP-compliant numbers in the
// Montreal (514) and Toronto (416) area codes. The 555-XXXX range is
// reserved for fiction so we use 555-0100 (valid) or avoid 555 entirely.

import {
  normalizeValidPhone,
  pickBestPhone,
  isLikelyResidentialOrInsufficient,
  buildDirectImportToLeads,
  countRowsWithPhone,
} from "./directImportToLeads.js";

// ── normalizeValidPhone ────────────────────────────────────────────────────

describe("normalizeValidPhone", () => {
  test("returns 10-digit string for a valid formatted NANP number", () => {
    // (514) 234-5678 — area 514, exchange 234 (not 555), valid
    expect(normalizeValidPhone("(514) 234-5678")).toBe("5142345678");
  });

  test("returns 10-digit string for a plain 10-digit number", () => {
    expect(normalizeValidPhone("5142345678")).toBe("5142345678");
  });

  test("strips +1 country code", () => {
    expect(normalizeValidPhone("+15142345678")).toBe("5142345678");
  });

  test("returns null for a 7-digit local number (no area code)", () => {
    expect(normalizeValidPhone("234-5678")).toBeNull();
  });

  test("returns null for null/undefined", () => {
    expect(normalizeValidPhone(null)).toBeNull();
    expect(normalizeValidPhone(undefined)).toBeNull();
  });

  test("returns null for an all-zeros number", () => {
    expect(normalizeValidPhone("0000000000")).toBeNull();
  });

  test("returns null for repeating digits", () => {
    // 7+ identical digits in a row — fails the repeated-digit check
    expect(normalizeValidPhone("5141111111")).toBeNull();
  });
});

// ── pickBestPhone ──────────────────────────────────────────────────────────

describe("pickBestPhone", () => {
  test("returns first valid phone from inputPhones array", () => {
    const row = { inputPhones: ["5142345678", "4162345678"] };
    expect(pickBestPhone(row)).toBe("5142345678");
  });

  test("falls back to phone field when inputPhones is empty", () => {
    const row = { inputPhones: [], phone: "(438) 234-5678" };
    expect(pickBestPhone(row)).toBe("4382345678");
  });

  test("returns null when no valid phone exists", () => {
    const row = { inputPhones: [], phone: "" };
    expect(pickBestPhone(row)).toBeNull();
  });

  test("returns null for a null/undefined row", () => {
    expect(pickBestPhone(null)).toBeNull();
    expect(pickBestPhone(undefined)).toBeNull();
  });

  test("picks the first valid phone when multiple exist in inputPhones", () => {
    // First entry is invalid; second is valid
    const row = { inputPhones: ["not-a-phone", "4162345678"] };
    expect(pickBestPhone(row)).toBe("4162345678");
  });

  test("scans rawRow columns as last-resort fallback", () => {
    const row = {
      inputPhones: [],
      phone: "",
      rawRow: { col_a: "Entreprise ABC", Téléphone: "5142345678" },
    };
    expect(pickBestPhone(row)).toBe("5142345678");
  });
});

// ── isLikelyResidentialOrInsufficient ─────────────────────────────────────

describe("isLikelyResidentialOrInsufficient", () => {
  test("returns true when no name and no address", () => {
    expect(isLikelyResidentialOrInsufficient({ companyName: "", address: "" })).toBe(true);
  });

  test("returns false when companyName is present", () => {
    expect(isLikelyResidentialOrInsufficient({ companyName: "Acme Inc", address: "" })).toBe(false);
  });

  test("returns false when buildingAddress is present", () => {
    expect(isLikelyResidentialOrInsufficient({ companyName: "", buildingAddress: "123 rue Main" })).toBe(false);
  });

  test("returns false when both name and address present", () => {
    expect(isLikelyResidentialOrInsufficient({
      companyName: "Acme",
      buildingAddress: "123 Main",
    })).toBe(false);
  });

  test("returns true for null row", () => {
    expect(isLikelyResidentialOrInsufficient(null)).toBe(true);
  });

  test("returns false for raw role row with owner and building address", () => {
    expect(isLikelyResidentialOrInsufficient({
      "Propriétaire1_Nom": "GESTION CML 2008 INC.",
      "Adresse Immeuble": "361 rue Girouard",
      "Téléphone Immeuble": "8197580387",
    })).toBe(false);
  });
});

// ── buildDirectImportToLeads ───────────────────────────────────────────────

describe("buildDirectImportToLeads", () => {
  test("returns empty arrays for empty input", () => {
    const result = buildDirectImportToLeads([]);
    expect(result.leadsToExport).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  test("returns empty arrays for non-array input", () => {
    const result = buildDirectImportToLeads(null);
    expect(result.leadsToExport).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  test("converts a row with a valid phone to a lead record", () => {
    const rows = [
      {
        companyName: "Acme Inc",
        inputPhones: ["5142345678"],
        buildingAddress: "100 rue Main, Montréal",
        city: "Montréal",
        province: "QC",
        postalCode: "H1A 1A1",
      },
    ];
    const { leadsToExport, skipped } = buildDirectImportToLeads(rows);
    expect(leadsToExport).toHaveLength(1);
    expect(skipped).toHaveLength(0);
    const lead = leadsToExport[0];
    expect(lead.phone).toBe("5142345678");
    expect(lead.status).toBe("ready_to_call");
    expect(lead._directImport).toBe(true);
    expect(lead.candidatePhones).toHaveLength(1);
    expect(lead.candidatePhones[0].source).toBe("imported_with_phone");
    expect(lead.candidatePhones[0].confidence).toBe("high");
    expect(lead.candidatePhones[0].relationship_to_lead_owner).toBe("owner");
  });

  test("puts rows without a valid phone in skipped", () => {
    const rows = [
      { companyName: "Acme", inputPhones: [], phone: "" },
      { companyName: "Beta", inputPhones: ["4162345678"] },
    ];
    const { leadsToExport, skipped } = buildDirectImportToLeads(rows);
    expect(leadsToExport).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(leadsToExport[0].companyName).toBe("Beta");
    expect(skipped[0].companyName).toBe("Acme");
  });

  test("tags residential rows with likelyResidential=true", () => {
    const rows = [
      { inputPhones: ["5142345678"], companyName: "", address: "", buildingAddress: "" },
    ];
    const { leadsToExport } = buildDirectImportToLeads(rows);
    expect(leadsToExport[0].likelyResidential).toBe(true);
  });

  test("tags normal business rows with likelyResidential=false", () => {
    const rows = [
      { inputPhones: ["5142345678"], companyName: "Acme", buildingAddress: "123 Main" },
    ];
    const { leadsToExport } = buildDirectImportToLeads(rows);
    expect(leadsToExport[0].likelyResidential).toBe(false);
  });

  test("picks the best phone when multiple are present in inputPhones", () => {
    // First inputPhone is invalid, second and third are valid — picks first valid
    const rows = [
      { companyName: "Acme", inputPhones: ["bad", "5142345678", "4162349999"] },
    ];
    const { leadsToExport } = buildDirectImportToLeads(rows);
    expect(leadsToExport[0].phone).toBe("5142345678");
  });

  test("falls back to leadContact as display name when companyName is absent", () => {
    const rows = [
      { companyName: "", leadContact: "Jean Tremblay", inputPhones: ["5142345678"] },
    ];
    const { leadsToExport } = buildDirectImportToLeads(rows);
    expect(leadsToExport[0].lead_owner_name).toBe("Jean Tremblay");
    expect(leadsToExport[0].candidatePhones[0].phone_owner_name).toBe("Jean Tremblay");
  });

  test("handles malformed phone strings gracefully", () => {
    const rows = [
      { companyName: "Acme", inputPhones: ["not-a-phone", "garbage", "123"] },
    ];
    const { leadsToExport, skipped } = buildDirectImportToLeads(rows);
    expect(leadsToExport).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  test("maps raw role columns into the fields the Leads importer needs", () => {
    const rows = [
      {
        "Propriétaire1_Nom": "GESTION CML 2008 INC.",
        "Adresse Immeuble": "361 RUE GIROUARD",
        "Ville Immeuble": "VICTORIAVILLE",
        "Province": "QC",
        "Code Postal Immeuble": "G6T0T8",
        "Téléphone Immeuble": "819-758-0387",
      },
    ];

    const { leadsToExport, skipped } = buildDirectImportToLeads(rows);
    expect(skipped).toHaveLength(0);
    expect(leadsToExport).toHaveLength(1);
    expect(leadsToExport[0]).toMatchObject({
      lead_owner_name: "GESTION CML 2008 INC.",
      leadContact: "GESTION CML 2008 INC.",
      companyName: "GESTION CML 2008 INC.",
      buildingAddress: "361 RUE GIROUARD",
      inputAddress: "361 RUE GIROUARD",
      matchedAddress: "361 RUE GIROUARD",
      city: "VICTORIAVILLE",
      province: "QC",
      postalCode: "G6T0T8",
      phone: "8197580387",
      bestPhone: "8197580387",
      source: "file_direct_import",
      status: "ready_to_call",
    });
    expect(leadsToExport[0].candidatePhones[0]).toMatchObject({
      phone: "8197580387",
      confidence: "high",
      source: "imported_with_phone",
      relationship_to_lead_owner: "owner",
      phone_owner_name: "GESTION CML 2008 INC.",
    });
  });

  test("maps nested rawRow role columns too", () => {
    const rows = [
      {
        rawRow: {
          "Propriétaire1_Nom": "ROBERT, CHRISTIAN",
          "Adresse Immeuble": "180 RUE NOTRE-DAME",
          "Ville Immeuble": "SAINT-PIE",
          "Téléphone": "450-234-5678",
        },
      },
    ];

    const { leadsToExport } = buildDirectImportToLeads(rows);
    expect(leadsToExport[0].lead_owner_name).toBe("ROBERT, CHRISTIAN");
    expect(leadsToExport[0].buildingAddress).toBe("180 RUE NOTRE-DAME");
    expect(leadsToExport[0].city).toBe("SAINT-PIE");
    expect(leadsToExport[0].phone).toBe("4502345678");
  });
});

// ── countRowsWithPhone ─────────────────────────────────────────────────────

describe("countRowsWithPhone", () => {
  test("returns 0 for empty array", () => {
    expect(countRowsWithPhone([])).toBe(0);
  });

  test("returns 0 for null", () => {
    expect(countRowsWithPhone(null)).toBe(0);
  });

  test("counts only rows with a valid phone", () => {
    const rows = [
      { inputPhones: ["5142345678"] },            // valid via inputPhones
      { inputPhones: [] },                         // no phone
      { phone: "4162349876" },                     // valid via phone field
      { inputPhones: [], phone: "" },              // no phone
    ];
    expect(countRowsWithPhone(rows)).toBe(2);
  });
});

// ── PR #32 P1 fix — pickBestPhone multi-column detection ──────────────────

describe("pickBestPhone — multi-column detection (PR #32 P1 fix)", () => {
  test("finds phone in the mapped phone column", () => {
    const row = { phone: "(514) 555-0100", companyName: "X" };
    expect(pickBestPhone(row)).toBeTruthy();
  });

  test("finds phone in a non-mapped column (Téléphone Immeuble)", () => {
    const row = {
      companyName: "X",
      "Téléphone Immeuble": "514-555-0100",
    };
    expect(pickBestPhone(row)).toBeTruthy();
  });

  test("finds phone in nested rawRow object", () => {
    const row = {
      companyName: "X",
      rawRow: { "Telephone": "5145550100" },
    };
    expect(pickBestPhone(row)).toBeTruthy();
  });

  test("returns null when no phone anywhere in the row", () => {
    expect(pickBestPhone({ companyName: "X" })).toBeFalsy();
  });

  test("ignores invalid phone-like strings (too few digits)", () => {
    expect(pickBestPhone({ phone: "123" })).toBeFalsy();
    expect(pickBestPhone({ phone: "abc" })).toBeFalsy();
  });
});

// ── Dashboard / enrichment partition consistency (Codex P1) ───────────────

describe("dashboard / enrichment partition consistency (Codex P1)", () => {
  test("a row with phone in non-mapped column is counted as 'with phone' AND excluded from missing-phone payload", () => {
    const rows = [
      { companyName: "A", phone: "5145550100" },                    // mapped phone
      { companyName: "B", "Téléphone Immeuble": "5145550101" },     // non-mapped
      { companyName: "C", rawRow: { Tel: "5145550102" } },          // nested
      { companyName: "D" },                                          // no phone anywhere
    ];

    const withPhone = countRowsWithPhone(rows);
    const missingPhone = rows.filter(r => !pickBestPhone(r));

    expect(withPhone).toBe(3);
    expect(missingPhone.length).toBe(1);
    expect(missingPhone[0].companyName).toBe("D");
    // The two counts must partition the input cleanly.
    expect(withPhone + missingPhone.length).toBe(rows.length);
  });

  test("the enrichment payload never contains rows already counted by countRowsWithPhone", () => {
    const rows = [
      { companyName: "A", phone: "5145550100" },
      { companyName: "B", "Téléphone Immeuble": "5145550101" },
      { companyName: "C" },
    ];
    const withPhoneCount = countRowsWithPhone(rows);
    const missingPhone = rows.filter(r => !pickBestPhone(r));
    expect(missingPhone.every(r => !pickBestPhone(r))).toBe(true);
    expect(withPhoneCount + missingPhone.length).toBe(rows.length);
  });
});
