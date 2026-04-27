import {
  extractOwnerInfo,
  deriveOwnerKey,
  deriveOwnerKeyForLead,
  groupRowsByOwner,
  migrateLeadsToOwners,
  mergeOwners,
  ownersToLookupRows,
  applyLookupResultsToOwners,
  ensureBuildingFinances,
  computeBuildingNOI,
  computeBuildingTotalUnits,
} from "./ownerGrouping.js";

// Helper — the shape returned by LeadsManager's `prepared` row, minimal.
function makeRow({ companyName = "", contactName = "", address = "", city = "", postalCode = "", phone = "", email = "", rawRow = {}, ...rest } = {}) {
  return {
    companyName, contactName, address, city, postalCode, phone, email,
    province: "QC",
    country: "Canada",
    buildingAddress: [address, city, "QC", postalCode].filter(Boolean).join(", "),
    inputPhones: phone ? [phone] : [],
    units: 0, utilisation: "", assessment: "", yearBuilt: "", lotArea: "",
    rawRow,
    ...rest,
  };
}

describe("extractOwnerInfo", () => {
  test("picks owner address from Propriétaire1_Adresse_clean", () => {
    const info = extractOwnerInfo({
      "Propriétaire1_Nom": "9338-8387 QUEBEC INC.",
      "Propriétaire1_Adresse_clean": "217 Saint-Jacques, Montréal",
      "Propriétaire1_CP": "H2Y 1M6",
    });
    expect(info.name).toBe("9338-8387 QUEBEC INC.");
    expect(info.address).toBe("217 Saint-Jacques, Montréal");
    expect(info.postalCode).toBe("H2Y 1M6");
  });

  test("tolerates snake_case + underscores", () => {
    const info = extractOwnerInfo({
      "proprietaire_nom": "Jean Tremblay",
      "proprietaire_adresse": "100 rue de la Gauchetière",
      "proprietaire_code_postal": "H3B 2A2",
    });
    expect(info.name).toBe("Jean Tremblay");
    expect(info.address).toContain("Gauchetière");
    expect(info.postalCode).toBe("H3B 2A2");
  });

  test("returns empty strings on unrelated columns", () => {
    const info = extractOwnerInfo({ "Adresse Immeuble": "5 Elm St", "Ville": "Laval" });
    expect(info.name).toBe("");
    expect(info.address).toBe("");
  });
});

describe("deriveOwnerKey", () => {
  test("three numbered companies at the same mailing address collapse", () => {
    const rows = [
      makeRow({
        companyName: "9338-8387 QUEBEC INC.",
        address: "1234 Building A",
        postalCode: "H1A 1A1",
        rawRow: {
          "Propriétaire1_Nom": "Jean Tremblay",
          "Propriétaire1_Adresse": "217 Saint-Jacques",
          "Propriétaire1_CP": "H2Y 1M6",
        },
      }),
      makeRow({
        companyName: "9440-5222 QUEBEC INC.",
        address: "5678 Building B",
        postalCode: "H1B 1B1",
        rawRow: {
          "Propriétaire1_Nom": "Jean Tremblay",
          "Propriétaire1_Adresse": "217 rue Saint-Jacques",
          "Propriétaire1_CP": "H2Y 1M6",
        },
      }),
      makeRow({
        companyName: "Fiducie Famille Tremblay",
        address: "9101 Building C",
        postalCode: "H1C 1C1",
        rawRow: {
          "Propriétaire1_Nom": "Fiducie Famille Tremblay",
          "Propriétaire1_Adresse": "217 St-Jacques app. 3",
          "Propriétaire1_CP": "h2y1m6",
        },
      }),
    ];
    const keys = rows.map(deriveOwnerKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toContain("217 saint jacques");
    expect(keys[0]).toContain("h2y1m6");
  });

  test("falls back to building address when no owner columns exist", () => {
    const row = makeRow({ address: "100 Elm", postalCode: "H3A 1A1", rawRow: {} });
    expect(deriveOwnerKey(row)).toBe("100 elm|h3a1a1");
  });

  test("returns empty when nothing usable", () => {
    const blank = { companyName: "", contactName: "", address: "", city: "", postalCode: "", phone: "", email: "", province: "", country: "", buildingAddress: "", inputPhones: [], rawRow: {} };
    expect(deriveOwnerKey(blank)).toBe("");
  });
});

describe("groupRowsByOwner", () => {
  test("58-building scenario: three companies, one owner", () => {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      rows.push(makeRow({
        companyName: "9338-8387 QUEBEC INC.",
        contactName: "Jean Tremblay",
        address: `100${i} Elm`,
        city: "Montréal",
        postalCode: `H1A 1A${i}`,
        phone: "514-555-1111",
        rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" },
      }));
    }
    for (let i = 0; i < 2; i++) {
      rows.push(makeRow({
        companyName: "9440-5222 QUEBEC INC.",
        contactName: "Jean Tremblay",
        address: `200${i} Oak`,
        city: "Montréal",
        postalCode: `H1B 1B${i}`,
        phone: "514-555-1111",
        rawRow: { "Propriétaire1_Adresse": "217 rue Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" },
      }));
    }
    const owners = groupRowsByOwner(rows);
    expect(owners.length).toBe(1);
    const owner = owners[0];
    expect(owner.displayName).toBe("Jean Tremblay");
    expect(owner.aliases).toEqual(expect.arrayContaining([
      "9338-8387 QUEBEC INC.",
      "9440-5222 QUEBEC INC.",
    ]));
    expect(owner.buildings.length).toBe(5);
    expect(owner.phones).toEqual(["514-555-1111"]); // deduped
  });

  test("different postal addresses create distinct owners", () => {
    const rows = [
      makeRow({ address: "100 Elm", postalCode: "H1A 1A1", rawRow: { "Propriétaire1_Adresse": "A", "Propriétaire1_CP": "H2Y 1M6" } }),
      makeRow({ address: "200 Oak", postalCode: "H1B 1B1", rawRow: { "Propriétaire1_Adresse": "B", "Propriétaire1_CP": "G1R 2K7" } }),
    ];
    const owners = groupRowsByOwner(rows);
    expect(owners.length).toBe(2);
  });

  test("displayName picks the most common Propriétaire name", () => {
    const rows = [
      makeRow({ contactName: "Jean Tremblay", address: "1 A", postalCode: "H1A 1A1", rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" } }),
      makeRow({ contactName: "Jean Tremblay", address: "2 A", postalCode: "H1A 1A2", rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" } }),
      makeRow({ contactName: "J. Tremblay",    address: "3 A", postalCode: "H1A 1A3", rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" } }),
    ];
    const owners = groupRowsByOwner(rows);
    expect(owners[0].displayName).toBe("Jean Tremblay");
  });

  test("deduplicates phones and emails across the group", () => {
    const rows = [
      makeRow({ phone: "5145551111", email: "a@b.com", address: "1 A", postalCode: "H1A 1A1", rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" } }),
      makeRow({ phone: "(514) 555-1111", email: "A@b.com", address: "2 A", postalCode: "H1A 1A2", rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" } }),
      makeRow({ phone: "514.555.2222", email: "c@b.com", address: "3 A", postalCode: "H1A 1A3", rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" } }),
    ];
    const owners = groupRowsByOwner(rows);
    expect(owners[0].phones.length).toBe(2);
    expect(owners[0].emails.length).toBe(2);
  });

  test("empty input yields empty owners", () => {
    expect(groupRowsByOwner([])).toEqual([]);
    expect(groupRowsByOwner(null)).toEqual([]);
  });
});

describe("migrateLeadsToOwners", () => {
  test("groups legacy building leads that share a building postal", () => {
    const leads = [
      { id: "l1", companyName: "9338-8387 QUEBEC INC.", contactName: "Jean Tremblay", address: "217 Saint-Jacques", postalCode: "H2Y 1M6", phone: "514-555-1111", phones: ["514-555-1111"], stage: "to_call", callNotes: "Rappelé mardi", updatedAt: 100 },
      { id: "l2", companyName: "9440-5222 QUEBEC INC.", contactName: "Jean Tremblay", address: "217 rue Saint-Jacques", postalCode: "H2Y1M6",  phone: "514-555-2222", phones: ["514-555-2222"], stage: "new",     callNotes: "",              updatedAt: 200 },
      { id: "l3", companyName: "Autre Investisseur",      contactName: "Marie Côté",    address: "4000 Sainte-Catherine", postalCode: "H3Z 1P1", phone: "514-555-3333", phones: ["514-555-3333"], stage: "contacted", callNotes: "VM le 4/18",     updatedAt: 300 },
    ];
    const owners = migrateLeadsToOwners(leads);
    expect(owners.length).toBe(2);
    const tremblay = owners.find(o => o.displayName === "Jean Tremblay");
    expect(tremblay.aliases).toEqual(expect.arrayContaining([
      "9338-8387 QUEBEC INC.",
      "9440-5222 QUEBEC INC.",
    ]));
    expect(tremblay.phones.length).toBe(2);
    expect(tremblay.buildings.length).toBe(2);
    expect(tremblay.stage).toBe("to_call"); // best of to_call + new
    expect(tremblay.callNotes).toContain("Rappelé mardi");
  });

  test("stage promotion picks the most advanced", () => {
    const leads = [
      { id: "l1", address: "1 A", postalCode: "H1A 1A1", stage: "new" },
      { id: "l2", address: "1 A", postalCode: "H1A 1A1", stage: "converted" },
      { id: "l3", address: "1 A", postalCode: "H1A 1A1", stage: "to_call" },
    ];
    const owners = migrateLeadsToOwners(leads);
    expect(owners[0].stage).toBe("converted");
  });

  test("empty/null input", () => {
    expect(migrateLeadsToOwners([])).toEqual([]);
    expect(migrateLeadsToOwners(null)).toEqual([]);
  });

  test("lead with no usable key is skipped", () => {
    const leads = [{ id: "l1", companyName: "Ghost" }];
    expect(migrateLeadsToOwners(leads)).toEqual([]);
  });
});

describe("mergeOwners", () => {
  const owner = (ownerKey, fields = {}) => ({
    id: `owner_${ownerKey.slice(0, 5)}`,
    ownerKey,
    displayName: "Jean Tremblay",
    postalAddress: { street: "217 Saint-Jacques", city: "Montréal", province: "QC", postalCode: "H2Y 1M6" },
    aliases: ["9338-8387 QUEBEC INC."],
    phones: ["514-555-1111"],
    emails: [],
    buildings: [{ id: "b1", address: "100 Elm", postalCode: "H1A 1A1" }],
    stage: "new", callStatus: "none", callNotes: "", notes: "",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: 1,
    lookupStatus: "pending",
    ...fields,
  });

  test("new owner is appended, existing state preserved on merge", () => {
    const existing = [owner("217 saint jacques|h2y1m6", { stage: "contacted", callNotes: "Important — rappel avril" })];
    const incoming = [owner("4000 sainte catherine|h3z1p1", { displayName: "Marie Côté" })];
    const { merged, addedCount } = mergeOwners(existing, incoming);
    expect(addedCount).toBe(1);
    expect(merged.length).toBe(2);
    expect(merged[0].stage).toBe("contacted");
    expect(merged[0].callNotes).toContain("rappel avril");
  });

  test("same owner gets buildings/aliases extended, call notes preserved", () => {
    const existing = [owner("217 saint jacques|h2y1m6", {
      stage: "contacted",
      callNotes: "Appel fait le 4/18",
      buildings: [{ id: "b1", address: "100 Elm", postalCode: "H1A 1A1" }],
    })];
    const incoming = [owner("217 saint jacques|h2y1m6", {
      aliases: ["9440-5222 QUEBEC INC."],
      phones: ["514-555-2222"],
      buildings: [{ id: "b2", address: "200 Oak", postalCode: "H1B 1B1" }],
    })];
    const { merged, updatedCount } = mergeOwners(existing, incoming);
    expect(updatedCount).toBe(1);
    expect(merged[0].stage).toBe("contacted");
    expect(merged[0].callNotes).toBe("Appel fait le 4/18");
    expect(merged[0].buildings.length).toBe(2);
    expect(merged[0].aliases.length).toBe(2);
    expect(merged[0].phones.length).toBe(2);
  });

  test("merge preserves existing file candidates and appends incoming online ones", () => {
    const fileCand = {
      phone: "(514) 555-1111", source: "file", source_column: "Téléphone",
      phone_owner_name: "Jean Tremblay", relationship_to_lead_owner: "owner",
      confidence: 85, evidence: "from file", status: "unverified",
    };
    const onlineCand = {
      phone: "(438) 555-0144", source: "google_places", source_column: "",
      phone_owner_name: "ABC Inc.", relationship_to_lead_owner: "owner",
      confidence: 70, evidence: "Places match", status: "unverified",
    };
    const existing = [owner("217 saint jacques|h2y1m6", {
      candidatePhones: [fileCand], candidateEmails: [], candidateWebsites: [],
    })];
    const incoming = [owner("217 saint jacques|h2y1m6", {
      candidatePhones: [onlineCand], candidateEmails: [], candidateWebsites: [],
    })];
    const { merged } = mergeOwners(existing, incoming);
    expect(merged[0].candidatePhones).toHaveLength(2);
    const sources = merged[0].candidatePhones.map(c => c.source).sort();
    expect(sources).toEqual(["file", "google_places"]);
    // The file candidate retained its source_column attribution.
    const fc = merged[0].candidatePhones.find(c => c.source === "file");
    expect(fc.source_column).toBe("Téléphone");
  });

  test("same building isn't duplicated on re-import", () => {
    const b = { id: "b1", address: "100 Elm", postalCode: "H1A 1A1" };
    const existing = [owner("217 saint jacques|h2y1m6", { buildings: [b] })];
    const incoming = [owner("217 saint jacques|h2y1m6", { buildings: [{ id: "b2", address: "100 Elm", postalCode: "H1A 1A1" }] })];
    const { merged, unchangedCount } = mergeOwners(existing, incoming);
    expect(merged[0].buildings.length).toBe(1);
    expect(unchangedCount).toBe(1);
  });
});

describe("deriveOwnerKeyForLead", () => {
  test("uses building address + postal when rawRow is missing", () => {
    const key = deriveOwnerKeyForLead({ address: "217 Saint-Jacques", postalCode: "H2Y 1M6" });
    expect(key).toBe("217 saint jacques|h2y1m6");
  });

  test("uses rawRow owner address when present", () => {
    const key = deriveOwnerKeyForLead({
      address: "100 Elm",
      postalCode: "H1A 1A1",
      rawRow: { "Propriétaire1_Adresse": "217 Saint-Jacques", "Propriétaire1_CP": "H2Y 1M6" },
    });
    expect(key).toBe("217 saint jacques|h2y1m6");
  });
});

describe("ownersToLookupRows", () => {
  const owner = {
    id: "owner_abc",
    ownerKey: "217 saint jacques|h2y1m6",
    displayName: "Jean Tremblay",
    aliases: ["9338-8387 QUEBEC INC.", "9440-5222 QUEBEC INC."],
    postalAddress: {
      street: "217 rue Saint-Jacques",
      city: "Montréal",
      province: "QC",
      postalCode: "H2Y 1M6",
    },
  };

  test("produces one lookup row per owner (not per building)", () => {
    // Owner with many buildings still yields exactly one row — this is the
    // whole point of the dedup: 58 buildings → 1 Google Places query pass.
    const rows = ownersToLookupRows([{ ...owner, buildings: new Array(58).fill({ address: "x" }) }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe("owner_abc");
    expect(rows[0].ownerKey).toBe(owner.ownerKey);
  });

  test("stamps Propriétaire{N}_Nom columns for displayName + each alias", () => {
    const [{ row }] = ownersToLookupRows([owner]);
    // displayName comes first, then aliases in order.
    expect(row["Propriétaire1_Nom"]).toBe("Jean Tremblay");
    expect(row["Propriétaire2_Nom"]).toBe("9338-8387 QUEBEC INC.");
    expect(row["Propriétaire3_Nom"]).toBe("9440-5222 QUEBEC INC.");
    // All three share the same mailing address — that's the identity rule.
    expect(row["Propriétaire1_Adresse"]).toBe("217 rue Saint-Jacques");
    expect(row["Propriétaire2_Adresse"]).toBe("217 rue Saint-Jacques");
    expect(row["Propriétaire3_Adresse"]).toBe("217 rue Saint-Jacques");
  });

  test("leaves building-level fields empty so pipeline skips building queries", () => {
    const [{ row }] = ownersToLookupRows([owner]);
    expect(row["Adresse"]).toBe("");
    expect(row["Latitude"]).toBe("");
    expect(row["Longitude"]).toBe("");
  });

  test("skips owners with no usable mailing address", () => {
    const noAddr = { id: "o_noaddr", ownerKey: "|", postalAddress: {}, aliases: [], displayName: "X" };
    expect(ownersToLookupRows([noAddr])).toEqual([]);
  });

  test("dedupes when displayName equals an alias", () => {
    const o = { ...owner, displayName: "9338-8387 QUEBEC INC.", aliases: ["9338-8387 QUEBEC INC.", "Autre Cie"] };
    const [{ row }] = ownersToLookupRows([o]);
    expect(row["Propriétaire1_Nom"]).toBe("9338-8387 QUEBEC INC.");
    expect(row["Propriétaire2_Nom"]).toBe("Autre Cie");
    // Should NOT have 3 entries — dedupe collapsed the duplicate alias.
    expect(row["Propriétaire3_Nom"]).toBeUndefined();
  });

  test("caps aliases at 4 to stay within a reasonable topN budget", () => {
    const many = { ...owner, displayName: "Primary", aliases: ["A", "B", "C", "D", "E", "F"] };
    const [{ row }] = ownersToLookupRows([many]);
    // displayName + 3 aliases = 4 total
    expect(row["Propriétaire1_Nom"]).toBe("Primary");
    expect(row["Propriétaire4_Nom"]).toBe("C");
    expect(row["Propriétaire5_Nom"]).toBeUndefined();
  });
});

describe("ensureBuildingFinances", () => {
  test("fills in defaults when finances is missing", () => {
    const b = { id: "b1", address: "100 Elm" };
    const out = ensureBuildingFinances(b);
    expect(out.finances).toEqual({
      revenueAnnuel: null,
      depensesAnnuelles: null,
      unitMix: { u1_5: 0, u2_5: 0, u3_5: 0, u4_5: 0, u5_5_plus: 0 },
    });
    // Does not mutate the input.
    expect(b.finances).toBeUndefined();
  });

  test("preserves existing finances values", () => {
    const b = {
      id: "b1",
      finances: {
        revenueAnnuel: 120000,
        depensesAnnuelles: 40000,
        unitMix: { u1_5: 1, u2_5: 3, u3_5: 5, u4_5: 2, u5_5_plus: 1 },
      },
    };
    const out = ensureBuildingFinances(b);
    expect(out.finances.revenueAnnuel).toBe(120000);
    expect(out.finances.depensesAnnuelles).toBe(40000);
    expect(out.finances.unitMix.u3_5).toBe(5);
    expect(out.finances.unitMix.u5_5_plus).toBe(1);
  });

  test("fills in missing unit-mix keys with 0", () => {
    const b = { id: "b1", finances: { revenueAnnuel: 1000, unitMix: { u3_5: 4 } } };
    const out = ensureBuildingFinances(b);
    expect(out.finances.unitMix).toEqual({ u1_5: 0, u2_5: 0, u3_5: 4, u4_5: 0, u5_5_plus: 0 });
    expect(out.finances.depensesAnnuelles).toBe(null);
  });

  test("returns the same value for null/undefined input", () => {
    expect(ensureBuildingFinances(null)).toBe(null);
    expect(ensureBuildingFinances(undefined)).toBe(undefined);
  });
});

describe("computeBuildingNOI", () => {
  test("returns revenue minus expenses when both present", () => {
    const b = { finances: { revenueAnnuel: 120000, depensesAnnuelles: 45000 } };
    expect(computeBuildingNOI(b)).toBe(75000);
  });

  test("returns null when either is missing", () => {
    expect(computeBuildingNOI({ finances: { revenueAnnuel: 100, depensesAnnuelles: null } })).toBe(null);
    expect(computeBuildingNOI({ finances: { revenueAnnuel: null, depensesAnnuelles: 100 } })).toBe(null);
    expect(computeBuildingNOI({ finances: {} })).toBe(null);
    expect(computeBuildingNOI({})).toBe(null);
    expect(computeBuildingNOI(null)).toBe(null);
  });

  test("allows negative NOI (expenses exceed revenue)", () => {
    const b = { finances: { revenueAnnuel: 10000, depensesAnnuelles: 15000 } };
    expect(computeBuildingNOI(b)).toBe(-5000);
  });
});

describe("computeBuildingTotalUnits", () => {
  test("sums all unit-mix counts", () => {
    const b = { finances: { unitMix: { u1_5: 1, u2_5: 2, u3_5: 3, u4_5: 4, u5_5_plus: 5 } } };
    expect(computeBuildingTotalUnits(b)).toBe(15);
  });

  test("returns 0 when unit-mix is missing", () => {
    expect(computeBuildingTotalUnits({})).toBe(0);
    expect(computeBuildingTotalUnits({ finances: {} })).toBe(0);
    expect(computeBuildingTotalUnits(null)).toBe(0);
  });

  test("coerces string counts to numbers (input-field friendly)", () => {
    const b = { finances: { unitMix: { u1_5: "2", u2_5: "3" } } };
    expect(computeBuildingTotalUnits(b)).toBe(5);
  });
});

describe("applyLookupResultsToOwners", () => {
  const mkOwner = (id, ownerKey, phones = []) => ({
    id, ownerKey, phones, lookupStatus: "pending", displayName: id, aliases: [], buildings: [],
    postalAddress: {},
  });

  test("merges new phones into the right owner", () => {
    const owners = [
      mkOwner("o1", "k1", []),
      mkOwner("o2", "k2", ["514-111-1111"]),
    ];
    const rowLookup = [
      { row: {}, ownerId: "o1", ownerKey: "k1" },
      { row: {}, ownerId: "o2", ownerKey: "k2" },
    ];
    const results = [
      { phone: "514-222-2222", status: "found", candidates: [] },
      { phone: "", status: "not_found", candidates: [{ phone: "514-333-3333" }] },
    ];
    const { owners: out, touched } = applyLookupResultsToOwners(owners, results, rowLookup);
    expect(touched).toBe(2);
    const o1 = out.find(o => o.id === "o1");
    const o2 = out.find(o => o.id === "o2");
    expect(o1.phones).toEqual(["514-222-2222"]);
    expect(o1.lookupStatus).toBe("found");
    // Candidate phone still ingested even when status is not_found — we take
    // every number the pipeline surfaced; the UI filters by confidence later.
    expect(o2.phones).toEqual(["514-111-1111", "514-333-3333"]);
    expect(o2.lookupStatus).toBe("not_found");
  });

  test("dedupes phones across existing + new", () => {
    const owners = [mkOwner("o1", "k1", ["(514) 111-1111"])];
    const rowLookup = [{ row: {}, ownerId: "o1", ownerKey: "k1" }];
    const results = [{ phone: "514-111-1111", status: "found", candidates: [] }];
    const { owners: out } = applyLookupResultsToOwners(owners, results, rowLookup);
    expect(out[0].phones).toEqual(["(514) 111-1111"]); // original format kept, dupe suppressed
  });

  test("ignores results that don't match any owner", () => {
    const owners = [mkOwner("o1", "k1", [])];
    const rowLookup = [{ row: {}, ownerId: "missing", ownerKey: "k-missing" }];
    const results = [{ phone: "514-222-2222", status: "found" }];
    const { owners: out, touched } = applyLookupResultsToOwners(owners, results, rowLookup);
    expect(out[0].phones).toEqual([]);
    expect(touched).toBe(0);
  });

  test("returns inputs unchanged when results/rowLookup are missing", () => {
    const owners = [mkOwner("o1", "k1", ["514-000-0000"])];
    const r = applyLookupResultsToOwners(owners, null, null);
    expect(r.owners).toBe(owners);
    expect(r.touched).toBe(0);
  });

  test("online lookup adds candidatePhones without overwriting file ones", () => {
    const fileCand = {
      phone: "(514) 555-0142", source: "file", source_column: "Téléphone",
      phone_owner_name: "Jean Tremblay", relationship_to_lead_owner: "owner",
      confidence: 85, evidence: "from longueuil.xlsx", status: "unverified",
    };
    const owners = [{
      ...mkOwner("o1", "k1", ["(514) 555-0142"]),
      candidatePhones: [fileCand],
      candidateEmails: [],
      candidateWebsites: [],
    }];
    const rowLookup = [{ row: {}, ownerId: "o1", ownerKey: "k1" }];
    const results = [{
      phone: "514-555-0147",
      status: "found",
      candidates: [],
      source: "google_places",
      matchedName: "ABC Inc.",
      confidence: 75,
      website: "https://abc-inc.com",
    }];
    const { owners: out } = applyLookupResultsToOwners(owners, results, rowLookup);
    const o1 = out[0];
    // File candidate is still there, untouched.
    const filePresent = o1.candidatePhones.find(c => c.source === "file");
    expect(filePresent).toBeTruthy();
    expect(filePresent.source_column).toBe("Téléphone");
    expect(filePresent.phone_owner_name).toBe("Jean Tremblay");
    // New online candidate appears alongside the file one.
    const onlinePresent = o1.candidatePhones.find(c => c.source === "google_places");
    expect(onlinePresent).toBeTruthy();
    expect(onlinePresent.phone).toBe("(514) 555-0147");
    // Online website surfaced as a candidate.
    expect(o1.candidateWebsites.find(c => c.website === "abc-inc.com")).toBeTruthy();
  });
});
