// proforma-web/src/lib/roleExtract.test.js
//
// Tests for the universal Québec rôle owner/address extractor.
// Covers Format A (Longueuil), Format B (compact indexed),
// Format C (Sherbrooke capital-P headers), Format D (prospection template),
// plus buildSearchAnchors and mailingAddresses[] integration with
// buildMailingAddressDiscoveryQueries.

import {
  detectRoleFormat,
  extractOwnerSlotsFromRow,
  buildSearchAnchors,
} from "./roleExtract.js";
import { buildMailingAddressDiscoveryQueries } from "./searchPackage.js";

// ─── detectRoleFormat ────────────────────────────────────────────────────────

describe("detectRoleFormat", () => {
  test("A_C: recognizes unsuffixed 'proprietaire' (slot 0)", () => {
    expect(detectRoleFormat(["proprietaire", "adresse postale", "telephone"])).toBe("A_C");
  });

  test("A_C: recognizes 'proprietaire 2' suffix (Longueuil-style)", () => {
    expect(
      detectRoleFormat([
        "proprietaire",
        "adresse postale",
        "telephone",
        "proprietaire 2",
        "adresse postale 2",
        "telephone 2",
      ]),
    ).toBe("A_C");
  });

  test("A_C: Sherbrooke capital-P normalizes identically to Longueuil", () => {
    // "Adresse Postale 2" normalizes to "adresse postale 2" — same as Format A
    expect(
      detectRoleFormat([
        "proprietaire",
        "adresse postale",
        "telephone",
        "proprietaire 2",
        "adresse postale 2", // normalized from "Adresse Postale 2"
      ]),
    ).toBe("A_C");
  });

  test("B: recognizes digit immediately after 'proprietaire'", () => {
    expect(
      detectRoleFormat([
        "proprietaire1 nom",
        "proprietaire1 adresse",
        "proprietaire1 telephone",
        "proprietaire2 nom",
      ]),
    ).toBe("B");
  });

  test("B: wins over A_C when both patterns appear (most-specific-first)", () => {
    expect(
      detectRoleFormat(["proprietaire1 nom", "proprietaire", "adresse postale"]),
    ).toBe("B");
  });

  test("D: recognizes 'proprio' vocabulary", () => {
    expect(
      detectRoleFormat([
        "nom proprio",
        "adresse proprio",
        "ville code postal proprio",
        "code postal proprio",
      ]),
    ).toBe("D");
  });

  test("unknown: returns unknown for unrecognized headers", () => {
    expect(detectRoleFormat(["owner name", "street address", "phone"])).toBe("unknown");
  });

  test("handles empty array", () => {
    expect(detectRoleFormat([])).toBe("unknown");
  });
});

// ─── extractOwnerSlotsFromRow — Format A (Longueuil) ─────────────────────────

describe("extractOwnerSlotsFromRow — Format A (Longueuil)", () => {
  const headers = [
    "Propriétaire",
    "Adresse postale",
    "Téléphone",
    "Propriétaire 2",
    "Adresse postale 2",
    "Téléphone 2",
    "Propriétaire 3",
    "Adresse postale 3",
    "Téléphone 3",
  ];

  // Phones use NANP-fictional 555-01XX exchange (officially reserved for
  // testing; phoneUtils.isValidNanpPhone accepts only this format on 555).
  const row = {
    "Propriétaire": "TREMBLAY Jean",
    "Adresse postale": "100 rue des Érables, Longueuil (Québec) J4H 1A1",
    "Téléphone": "450-555-0101",
    "Propriétaire 2": "9876-5432 QUÉBEC INC.",
    "Adresse postale 2": "200 boul. Industriel, Brossard (Québec) J4Z 1B2",
    "Téléphone 2": "",
    "Propriétaire 3": "",
    "Adresse postale 3": "",
    "Téléphone 3": "",
  };

  let slots;
  beforeEach(() => {
    slots = extractOwnerSlotsFromRow(row, headers);
  });

  test("returns two slots (slot 3 is empty, excluded)", () => {
    expect(slots).toHaveLength(2);
  });

  test("slot 0: name and slotIdx", () => {
    expect(slots[0].slotIdx).toBe(0);
    expect(slots[0].name).toBe("TREMBLAY Jean");
  });

  test("slot 0: mailing address parsed from combined column", () => {
    const addr = slots[0].mailingAddresses[0];
    expect(addr.street).toBe("100 rue des Érables");
    expect(addr.city).toBe("Longueuil");
    expect(addr.postalCode).toBe("J4H 1A1");
  });

  test("slot 0: phone extracted", () => {
    // mergePhoneLists returns the matched raw string verbatim
    expect(slots[0].phones).toContain("450-555-0101");
  });

  test("slot 1: slotIdx is 1 (second slot)", () => {
    expect(slots[1].slotIdx).toBe(1);
    expect(slots[1].name).toBe("9876-5432 QUÉBEC INC.");
  });

  test("slot 1: mailing address from Adresse postale 2", () => {
    const addr = slots[1].mailingAddresses[0];
    expect(addr.street).toBe("200 boul. Industriel");
    expect(addr.city).toBe("Brossard");
    expect(addr.postalCode).toBe("J4Z 1B2");
  });

  test("slot 1: empty phone → phones array is empty", () => {
    expect(slots[1].phones).toHaveLength(0);
  });

  test("building address column is absent → no contamination of mailing", () => {
    // No column named "Adresse Immeuble" in these headers — each slot's
    // mailing address must come only from its own Adresse postale column.
    expect(slots[0].mailingAddresses[0].street).not.toContain("Immeuble");
  });

  test("candidatePhones carry source attribution", () => {
    expect(slots[0].candidatePhones[0]).toMatchObject({
      source: "file",
      phone_owner_name: "TREMBLAY Jean",
      relationship_to_lead_owner: "owner",
    });
  });
});

// ─── extractOwnerSlotsFromRow — Format C (Sherbrooke capital-P) ──────────────

describe("extractOwnerSlotsFromRow — Format C (Sherbrooke, capital-P headers)", () => {
  // "Adresse Postale 2" has capital P — normalizeHeaderKey collapses it to
  // "adresse postale 2", identical to Format A's "Adresse postale 2".
  const headers = [
    "Propriétaire",
    "Adresse Postale",    // capital P
    "Téléphone",
    "Propriétaire 2",
    "Adresse Postale 2",  // capital P + space suffix
    "Téléphone 2",
  ];

  // 555-01XX is the only valid NANP-fictional sub-block; we stay inside it
  // for all test phones so phoneUtils.isValidNanpPhone accepts them.
  const row = {
    "Propriétaire": "FIDUCIE MARTIN 2020",
    "Adresse Postale": "50 rue King Ouest, Sherbrooke (Québec) J1H 1N4",
    "Téléphone": "819-555-0120",
    "Propriétaire 2": "MARTIN Paul",
    "Adresse Postale 2": "75 rue Wellington, Sherbrooke (Québec) J1H 5B4",
    "Téléphone 2": "819-555-0121",
  };

  let slots;
  beforeEach(() => {
    slots = extractOwnerSlotsFromRow(row, headers);
  });

  test("detects as A_C format (capital-P normalizes identically)", () => {
    const norm = headers.map((h) =>
      h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    );
    expect(detectRoleFormat(norm)).toBe("A_C");
  });

  test("returns two slots", () => {
    expect(slots).toHaveLength(2);
  });

  test("slot 0: Adresse Postale (capital P) parsed correctly", () => {
    expect(slots[0].mailingAddresses[0].city).toBe("Sherbrooke");
    expect(slots[0].mailingAddresses[0].postalCode).toBe("J1H 1N4");
  });

  test("Téléphone 2 → slot 1, Téléphone → slot 0 (correct slot mapping)", () => {
    expect(slots[1].phones).toContain("819-555-0121");
    expect(slots[0].phones).toContain("819-555-0120");
    // The two slots' phones must not cross-contaminate.
    expect(slots[0].phones).not.toContain("819-555-0121");
    expect(slots[1].phones).not.toContain("819-555-0120");
  });
});

// ─── extractOwnerSlotsFromRow — Format B (compact indexed) ───────────────────

describe("extractOwnerSlotsFromRow — Format B (compact indexed)", () => {
  const headers = [
    "Propriétaire1_Nom",
    "Propriétaire1_Adresse",
    "Propriétaire1_Téléphone",
    "Propriétaire2_Nom",
    "Propriétaire2_Adresse",
    "Propriétaire2_Téléphone",
    "Propriétaire3_Nom",
    "Propriétaire3_Adresse",
    "Propriétaire3_Téléphone",
    "Propriétaire4_Nom",
    "Propriétaire4_Adresse",
    "Propriétaire4_Téléphone",
  ];

  const row = {
    "Propriétaire1_Nom": "GESTION IMMOBILIÈRE GRANBY INC.",
    "Propriétaire1_Adresse": "1 rue Principale, Granby (Québec) J2G 2T2",
    "Propriétaire1_Téléphone": "450-555-0161",
    "Propriétaire2_Nom": "DURAND Sophie",
    "Propriétaire2_Adresse": "22 ave Cartier, Granby (Québec) J2H 2B2",
    "Propriétaire2_Téléphone": "450-555-0162",
    "Propriétaire3_Nom": "FIDUCIE DURAND",
    "Propriétaire3_Adresse": "22 ave Cartier, Granby (Québec) J2H 2B2",
    "Propriétaire3_Téléphone": "",
    "Propriétaire4_Nom": "",
    "Propriétaire4_Adresse": "",
    "Propriétaire4_Téléphone": "",
  };

  let slots;
  beforeEach(() => {
    slots = extractOwnerSlotsFromRow(row, headers);
  });

  test("detects as Format B", () => {
    const norm = headers.map((h) =>
      h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    );
    expect(detectRoleFormat(norm)).toBe("B");
  });

  test("returns three populated slots (slot 4 empty)", () => {
    expect(slots).toHaveLength(3);
  });

  test("slot 0: maps Propriétaire1_Nom → slot idx 0", () => {
    expect(slots[0].slotIdx).toBe(0);
    expect(slots[0].name).toBe("GESTION IMMOBILIÈRE GRANBY INC.");
  });

  test("slot 1: maps Propriétaire2_Nom → slot idx 1", () => {
    expect(slots[1].slotIdx).toBe(1);
    expect(slots[1].name).toBe("DURAND Sophie");
  });

  test("slot 0: address from Propriétaire1_Adresse", () => {
    expect(slots[0].mailingAddresses[0].street).toBe("1 rue Principale");
    expect(slots[0].mailingAddresses[0].city).toBe("Granby");
    expect(slots[0].mailingAddresses[0].postalCode).toBe("J2G 2T2");
  });

  test("slot 1: phone from Propriétaire2_Téléphone", () => {
    expect(slots[1].phones).toContain("450-555-0162");
  });

  test("slot 2: Fiducie at same address as slot 1, fanned out independently", () => {
    expect(slots[2].name).toBe("FIDUCIE DURAND");
    expect(slots[2].mailingAddresses[0].street).toBe("22 ave Cartier");
    // Fanned out independently — own slot object despite shared address
    expect(slots[2]).not.toBe(slots[1]);
  });

  test("slot 2: empty phone → phones array is empty", () => {
    expect(slots[2].phones).toHaveLength(0);
  });
});

// ─── extractOwnerSlotsFromRow — Format D (prospection template) ──────────────

describe("extractOwnerSlotsFromRow — Format D (prospection template)", () => {
  const headers = [
    "Nom_proprio",
    "Adresse_proprio",
    "Ville_code_postal_proprio",
    "Code postal-proprio",
    "Téléphone_proprio",
  ];

  test("detects as Format D", () => {
    const norm = headers.map((h) =>
      h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    );
    expect(detectRoleFormat(norm)).toBe("D");
  });

  test("extracts single slot from Nom_proprio", () => {
    const row = {
      "Nom_proprio": "INVESTISSEMENTS BEAUMONT INC.",
      "Adresse_proprio": "5 boul. des Entreprises",
      "Ville_code_postal_proprio": "Saint-Hyacinthe J2S 4B3",
      "Code postal-proprio": "",
      "Téléphone_proprio": "450-555-0163",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    expect(slots).toHaveLength(1);
    expect(slots[0].slotIdx).toBe(0);
    expect(slots[0].name).toBe("INVESTISSEMENTS BEAUMONT INC.");
  });

  test("parses city + postal from Ville_code_postal_proprio", () => {
    const row = {
      "Nom_proprio": "LEFEBVRE André",
      "Adresse_proprio": "12 rue des Lilas",
      "Ville_code_postal_proprio": "Drummondville J2B 1A1",
      "Code postal-proprio": "",
      "Téléphone_proprio": "",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    const addr = slots[0].mailingAddresses[0];
    expect(addr.street).toBe("12 rue des Lilas");
    expect(addr.city).toBe("Drummondville");
    expect(addr.postalCode).toBe("J2B 1A1");
  });

  test("uses Code postal-proprio when Ville_code_postal_proprio has no postal", () => {
    const row = {
      "Nom_proprio": "FORTIN Claire",
      "Adresse_proprio": "99 chemin du Lac",
      "Ville_code_postal_proprio": "Magog",
      "Code postal-proprio": "J1X 3W4",
      "Téléphone_proprio": "",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    expect(slots[0].mailingAddresses[0].postalCode).toBe("J1X 3W4");
    expect(slots[0].mailingAddresses[0].city).toBe("Magog");
  });

  test("extracts phone from Téléphone_proprio", () => {
    const row = {
      "Nom_proprio": "HOLDINGS XYZ INC.",
      "Adresse_proprio": "1000 rue des Affaires",
      "Ville_code_postal_proprio": "Sherbrooke J1K 9Z9",
      "Code postal-proprio": "",
      "Téléphone_proprio": "819-555-0150",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    expect(slots[0].phones).toContain("819-555-0150");
  });

  test("accepts Tel_proprio as a phone-column variant", () => {
    const altHeaders = ["Nom_proprio", "Adresse_proprio", "Tel_proprio"];
    const row = {
      "Nom_proprio": "GAGNON Pierre",
      "Adresse_proprio": "11 rue du Test",
      "Tel_proprio": "514-555-0175",
    };
    const slots = extractOwnerSlotsFromRow(row, altHeaders);
    expect(slots[0].phones).toContain("514-555-0175");
  });

  test("accepts Phone_proprio as a phone-column variant", () => {
    const altHeaders = ["Nom_proprio", "Adresse_proprio", "Phone_proprio"];
    const row = {
      "Nom_proprio": "BROWN Mary",
      "Adresse_proprio": "22 rue du Test",
      "Phone_proprio": "514-555-0188",
    };
    const slots = extractOwnerSlotsFromRow(row, altHeaders);
    expect(slots[0].phones).toContain("514-555-0188");
  });

  test("empty Nom_proprio → no slots", () => {
    const row = {
      "Nom_proprio": "",
      "Adresse_proprio": "100 rue Vide",
      "Ville_code_postal_proprio": "Québec G1A 0A1",
      "Code postal-proprio": "",
      "Téléphone_proprio": "",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    expect(slots).toHaveLength(0);
  });
});

// ─── buildSearchAnchors ──────────────────────────────────────────────────────

describe("buildSearchAnchors", () => {
  test("returns one anchor per mailing address", () => {
    const slot = {
      mailingAddresses: [
        { street: "100 rue Main", city: "Longueuil", province: "QC", postalCode: "J4H 1A1" },
        { street: "200 ave Park", city: "Brossard", province: "QC", postalCode: "J4Z 2C3" },
      ],
    };
    const anchors = buildSearchAnchors(slot);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toBe("100 rue Main, Longueuil, QC, J4H 1A1");
    expect(anchors[1]).toBe("200 ave Park, Brossard, QC, J4Z 2C3");
  });

  test("excludes addresses with no street and no (city+postal) pair", () => {
    const slot = {
      mailingAddresses: [
        { street: "", city: "", province: "QC", postalCode: "" },
        { street: "50 rue Util", city: "Québec", province: "QC", postalCode: "G1A 0A1" },
      ],
    };
    const anchors = buildSearchAnchors(slot);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toContain("50 rue Util");
  });

  test("returns empty array when no mailing addresses", () => {
    expect(buildSearchAnchors({ mailingAddresses: [] })).toHaveLength(0);
    expect(buildSearchAnchors(null)).toHaveLength(0);
    expect(buildSearchAnchors({})).toHaveLength(0);
  });

  test("building address does NOT appear in anchors", () => {
    // buildSearchAnchors only reads ownerSlot.mailingAddresses — the caller is
    // responsible for not passing building addresses in mailingAddresses[].
    const slot = {
      mailingAddresses: [
        { street: "500 rue des Propriétaires", city: "Laval", province: "QC", postalCode: "H7V 1K1" },
      ],
    };
    const anchors = buildSearchAnchors(slot);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).not.toContain("Immeuble");
  });
});

// ─── buildMailingAddressDiscoveryQueries with mailingAddresses[] ──────────────

describe("buildMailingAddressDiscoveryQueries with mailingAddresses[]", () => {
  test("generates queries for all addresses when mailingAddresses[] present", () => {
    const pkg = {
      lead_owner_name: "HOLDINGS QC INC.",
      mailingAddresses: [
        { street: "100 rue A", city: "Montréal", province: "QC", postalCode: "H1A 1A1" },
        { street: "200 rue B", city: "Laval", province: "QC", postalCode: "H7Z 2B2" },
      ],
    };
    const queries = buildMailingAddressDiscoveryQueries(pkg);
    // Both addresses should generate queries
    expect(queries.some((q) => q.includes("100 rue A"))).toBe(true);
    expect(queries.some((q) => q.includes("200 rue B"))).toBe(true);
  });

  test("falls back to flat mailing fields when mailingAddresses[] absent", () => {
    const pkg = {
      mailing_address: "300 rue C",
      mailing_city: "Québec",
      mailing_province: "QC",
      mailing_postal_code: "G1A 3C3",
    };
    const queries = buildMailingAddressDiscoveryQueries(pkg);
    expect(queries.some((q) => q.includes("300 rue C"))).toBe(true);
  });

  test("mailingAddresses[] takes precedence over flat fields", () => {
    const pkg = {
      mailing_address: "OLD flat address",
      mailingAddresses: [
        { street: "NEW array address", city: "Granby", province: "QC", postalCode: "J2G 1Z1" },
      ],
    };
    const queries = buildMailingAddressDiscoveryQueries(pkg);
    expect(queries.some((q) => q.includes("NEW array address"))).toBe(true);
    // Flat field should NOT appear when mailingAddresses[] is present
    expect(queries.some((q) => q.includes("OLD flat address"))).toBe(false);
  });

  test("skips empty addresses in mailingAddresses[]", () => {
    const pkg = {
      mailingAddresses: [
        { street: "", city: "", province: "QC", postalCode: "" },
        { street: "400 rue D", city: "Sherbrooke", province: "QC", postalCode: "J1K 4D4" },
      ],
    };
    const queries = buildMailingAddressDiscoveryQueries(pkg);
    expect(queries.some((q) => q.includes("400 rue D"))).toBe(true);
    // No queries for the empty address
    expect(queries.filter((q) => !q.trim()).length).toBe(0);
  });

  test("deduplicates identical queries across two addresses", () => {
    const pkg = {
      mailingAddresses: [
        { street: "100 rue A", city: "Montréal", province: "QC", postalCode: "H1A 1A1" },
        { street: "100 rue A", city: "Montréal", province: "QC", postalCode: "H1A 1A1" },
      ],
    };
    const queries = buildMailingAddressDiscoveryQueries(pkg);
    const unique = new Set(queries.map((q) => q.toLowerCase()));
    expect(unique.size).toBe(queries.length);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("extractOwnerSlotsFromRow — edge cases", () => {
  test("returns empty array for unknown format headers", () => {
    const headers = ["Owner", "Street", "Phone"];
    const row = { Owner: "Some Corp", Street: "123 Main", Phone: "555-0000" };
    expect(extractOwnerSlotsFromRow(row, headers)).toHaveLength(0);
  });

  test("returns empty array for null row", () => {
    expect(extractOwnerSlotsFromRow(null, ["Propriétaire"])).toHaveLength(0);
  });

  test("returns empty array for null headers", () => {
    expect(extractOwnerSlotsFromRow({ "Propriétaire": "X" }, null)).toHaveLength(0);
  });

  test("Format A: row with all empty owner columns → no slots", () => {
    const headers = ["Propriétaire", "Adresse postale", "Téléphone"];
    const row = { "Propriétaire": "", "Adresse postale": "", "Téléphone": "" };
    expect(extractOwnerSlotsFromRow(row, headers)).toHaveLength(0);
  });

  test("Format B: slot with name but no address → slot returned with empty mailingAddresses", () => {
    const headers = ["Propriétaire1_Nom", "Propriétaire1_Adresse", "Propriétaire1_Téléphone"];
    const row = {
      "Propriétaire1_Nom": "SOCIETE ANONYME",
      "Propriétaire1_Adresse": "",
      "Propriétaire1_Téléphone": "",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    expect(slots).toHaveLength(1);
    expect(slots[0].mailingAddresses).toHaveLength(0);
  });

  test("Format A: numbered company in slot 1 fanned out independently from slot 0", () => {
    const headers = [
      "Propriétaire", "Adresse postale", "Téléphone",
      "Propriétaire 2", "Adresse postale 2", "Téléphone 2",
    ];
    const row = {
      "Propriétaire": "GAGNON Pierre",
      "Adresse postale": "1 rue Principale, Victoriaville (Québec) G6P 1A1",
      "Téléphone": "819-555-0131",
      "Propriétaire 2": "9234-5678 QUÉBEC INC.",
      "Adresse postale 2": "99 rue Commerce, Victoriaville (Québec) G6P 9Z9",
      "Téléphone 2": "",
    };
    const slots = extractOwnerSlotsFromRow(row, headers);
    expect(slots).toHaveLength(2);
    expect(slots[0].name).toBe("GAGNON Pierre");
    expect(slots[1].name).toBe("9234-5678 QUÉBEC INC.");
    // Both are independent slot objects
    expect(slots[0].slotIdx).toBe(0);
    expect(slots[1].slotIdx).toBe(1);
    expect(slots[0].mailingAddresses[0].city).toBe("Victoriaville");
    expect(slots[1].mailingAddresses[0].street).toBe("99 rue Commerce");
  });
});
