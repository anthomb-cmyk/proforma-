import {
  parsePostalAddress,
  extractRoleData,
  buildOwnersAndLeadsFromRole,
  normalizeHeaderKey,
} from "./roleImport.js";

// Synthetic fixture mimicking the Longueuil rôle export shape: one row per
// property, unsuffixed columns for slot 0, " 2" / " 3" for the remaining
// slots. We only define the columns the parser actually reads; the real
// file has 93 columns but the column-detection is by name, not index.
const BASE_HEADERS = [
  "Ville",
  "Adresse Immeuble",
  "Numéro de matricule",
  "Utilisation prédominante",
  "Code Postal Immeuble",
  // Slot 0
  "Propriétaire",
  "Propriétaire Prénom",
  "Propriétaire Nom",
  "Statut aux fins d'imposition scolaire",
  "Adresse postale",
  "Téléphone",
  // Slot 1
  "Propriétaire 2",
  "Propriétaire 2 Prénom",
  "Propriétaire 2 Nom",
  "Statut aux fins d'imposition scolaire 2",
  "Adresse postale 2",
  "Téléphone 2",
  // Property detail
  "Valeur de l'immeuble",
  "Année de construction",
  "Date d'inscription au rôle",
  "Nombre de logements",
  "Nb Total Unités",
  "Lat",
  "Lon",
];

// Build a row, filling in unspecified columns with "".
function mkRow(overrides = {}) {
  const row = {};
  for (const h of BASE_HEADERS) row[h] = "";
  return { ...row, ...overrides };
}

describe("parsePostalAddress", () => {
  test("splits street + city + province + postal on the standard Québec format", () => {
    const out = parsePostalAddress("217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6");
    expect(out.street).toBe("217 rue Saint-Jacques");
    expect(out.city).toBe("Montréal");
    expect(out.province).toBe("Québec");
    expect(out.postalCode).toBe("H2Y 1M6");
  });

  test("handles postal without a space (H2Y1M6)", () => {
    const out = parsePostalAddress("1 rue Main, Longueuil (QC) J4K1A1");
    expect(out.postalCode).toBe("J4K1A1");
    expect(out.city).toBe("Longueuil");
  });

  test("returns empty object on blank", () => {
    expect(parsePostalAddress("")).toEqual({ street: "", city: "", province: "", postalCode: "" });
  });

  test("tolerates missing province parens", () => {
    const out = parsePostalAddress("100 Elm, Laval H7A 1B1");
    expect(out.street).toBe("100 Elm");
    expect(out.city).toBe("Laval");
    expect(out.province).toBe("");
    expect(out.postalCode).toBe("H7A 1B1");
  });
});

describe("normalizeHeaderKey", () => {
  test("strips accents, lowercases, collapses separators", () => {
    expect(normalizeHeaderKey("Propriétaire_2 Prénom")).toBe("proprietaire 2 prenom");
    expect(normalizeHeaderKey("  Adresse   postale  ")).toBe("adresse postale");
  });
});

describe("extractRoleData", () => {
  test("single property with one owner produces one Owner + one property", () => {
    const rows = [
      mkRow({
        "Ville": "Longueuil",
        "Adresse Immeuble": "100 rue des Érables",
        "Numéro de matricule": "1234-56-7890",
        "Utilisation prédominante": "Logement",
        "Code Postal Immeuble": "J4K 1A1",
        "Propriétaire": "Jean Tremblay",
        "Propriétaire Prénom": "Jean",
        "Propriétaire Nom": "Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0123",
        "Valeur de l'immeuble": "1200000",
        "Année de construction": "1965",
        "Nb Total Unités": "6",
      }),
    ];
    const out = extractRoleData({ headers: BASE_HEADERS, rows });
    expect(out.stats.properties).toBe(1);
    expect(out.stats.ownerEntries).toBe(1);
    expect(out.stats.uniquePostal).toBe(1);
    expect(out.stats.withPhone).toBe(1);
    expect(out.stats.needLookup).toBe(0);
    const [[, drafts]] = [...out.ownersMap.entries()];
    expect(drafts[0].postalAddress.postalCode).toBe("H2Y 1M6");
    expect(drafts[0].phones).toEqual(["514-555-0123"]);
  });

  test("two properties held by same owner (same postal) dedup to ONE owner", () => {
    const common = {
      "Propriétaire": "Jean Tremblay",
      "Propriétaire Prénom": "Jean",
      "Propriétaire Nom": "Tremblay",
      "Statut aux fins d'imposition scolaire": "Personne physique",
      "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      "Téléphone": "514-555-0123",
    };
    const rows = [
      mkRow({ ...common, "Ville": "Longueuil", "Adresse Immeuble": "100 Main", "Numéro de matricule": "A" }),
      mkRow({ ...common, "Ville": "Longueuil", "Adresse Immeuble": "200 Oak",  "Numéro de matricule": "B" }),
    ];
    const out = extractRoleData({ headers: BASE_HEADERS, rows });
    expect(out.stats.properties).toBe(2);
    expect(out.stats.ownerEntries).toBe(2);
    expect(out.stats.uniquePostal).toBe(1);
  });

  test("numbered company + fiducie at SAME postal collapse into one owner", () => {
    // Business case from the spec header: 9338 QC INC. and Fiducie Tremblay
    // both mail to the same address — they're the same human investor.
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "9338-8387 QUEBEC INC.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
      mkRow({
        "Adresse Immeuble": "200 Oak",
        "Numéro de matricule": "M2",
        "Propriétaire": "Fiducie Famille Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
    ];
    const out = extractRoleData({ headers: BASE_HEADERS, rows });
    expect(out.stats.uniquePostal).toBe(1);
    const [[, drafts]] = [...out.ownersMap.entries()];
    const names = drafts.map(d => d.name);
    expect(names).toEqual(expect.arrayContaining([
      "9338-8387 QUEBEC INC.",
      "Fiducie Famille Tremblay",
    ]));
  });

  test("two owner slots on the same row — spouses at same postal — one grouped owner", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Propriétaire Prénom": "Jean",
        "Propriétaire Nom": "Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0123",
        "Propriétaire 2": "Marie Côté",
        "Propriétaire 2 Prénom": "Marie",
        "Propriétaire 2 Nom": "Côté",
        "Statut aux fins d'imposition scolaire 2": "Personne physique",
        "Adresse postale 2": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone 2": "514-555-0145",
      }),
    ];
    const out = extractRoleData({ headers: BASE_HEADERS, rows });
    expect(out.stats.ownerEntries).toBe(2);
    expect(out.stats.uniquePostal).toBe(1);
    const [[, drafts]] = [...out.ownersMap.entries()];
    expect(drafts.map(d => d.name)).toEqual(["Jean Tremblay", "Marie Côté"]);
  });

  test("owner with no phone contributes to needLookup", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
    ];
    const out = extractRoleData({ headers: BASE_HEADERS, rows });
    expect(out.stats.needLookup).toBe(1);
    expect(out.stats.withPhone).toBe(0);
  });

  test("rows with neither civic address nor matricule are skipped", () => {
    const rows = [
      mkRow({ "Propriétaire": "Should be ignored" }),
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
    ];
    const out = extractRoleData({ headers: BASE_HEADERS, rows });
    expect(out.stats.properties).toBe(1);
  });
});

describe("buildOwnersAndLeadsFromRole", () => {
  const headers = BASE_HEADERS;

  test("Excel phones flow through with Excel source tag", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Propriétaire Prénom": "Jean",
        "Propriétaire Nom": "Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0123",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners, leads } = buildOwnersAndLeadsFromRole(parsed, [], { sourceFile: "longueil.xlsx" });
    expect(newOwners).toHaveLength(1);
    const [owner] = newOwners;
    expect(owner.phones).toEqual(["514-555-0123"]);
    // Source tagged by normalizePhoneKey — 10-digit key.
    expect(owner.phoneSources["5145550123"]).toBe("Excel");
    expect(leads).toHaveLength(1);
    expect(leads[0].ownerIds).toContain(owner.id);
    expect(leads[0].sourceFile).toBe("longueil.xlsx");
  });

  test("spouses at same postal with different names merge into one owner with both contactNames", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Propriétaire Prénom": "Jean",
        "Propriétaire Nom": "Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0123",
        "Propriétaire 2": "Marie Côté",
        "Propriétaire 2 Prénom": "Marie",
        "Propriétaire 2 Nom": "Côté",
        "Statut aux fins d'imposition scolaire 2": "Personne physique",
        "Adresse postale 2": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone 2": "514-555-0145",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners } = buildOwnersAndLeadsFromRole(parsed, []);
    expect(newOwners).toHaveLength(1);
    const [owner] = newOwners;
    expect(owner.contactNames).toEqual(expect.arrayContaining(["Jean Tremblay", "Marie Côté"]));
    expect(owner.phones).toHaveLength(2);
  });

  test("numbered company classified as alias, natural person as contactName", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "9338-8387 QUEBEC INC.",
        "Statut aux fins d'imposition scolaire": "Personne morale",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
      mkRow({
        "Adresse Immeuble": "200 Oak",
        "Numéro de matricule": "M2",
        "Propriétaire": "Jean Tremblay",
        "Propriétaire Prénom": "Jean",
        "Propriétaire Nom": "Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners } = buildOwnersAndLeadsFromRole(parsed, []);
    expect(newOwners).toHaveLength(1);
    const [owner] = newOwners;
    expect(owner.aliases).toContain("9338-8387 QUEBEC INC.");
    expect(owner.contactNames).toContain("Jean Tremblay");
    expect(owner.displayName).toBe("Jean Tremblay");
    expect(owner.buildings).toHaveLength(2);
  });

  test("re-import into an existing CRM merges — existing stage/notes preserved", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    // First import seeds the CRM.
    const first = buildOwnersAndLeadsFromRole(parsed, []);
    // Simulate the user doing work on that owner.
    const edited = first.allOwners.map(o => ({
      ...o,
      stage: "contacted",
      callNotes: "Laissé VM mardi",
    }));
    // Re-import the same rôle.
    const second = buildOwnersAndLeadsFromRole(parsed, edited);
    expect(second.newOwners).toHaveLength(0);
    expect(second.updatedOwners.length + second.allOwners.filter(o => o.stage === "contacted").length).toBeGreaterThan(0);
    // The owner's stage + callNotes survived the re-import.
    const again = second.allOwners.find(o => o.ownerKey === edited[0].ownerKey);
    expect(again.stage).toBe("contacted");
    expect(again.callNotes).toBe("Laissé VM mardi");
  });

  test("each property becomes a Lead linked to its owner(s) by ownerId", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0123",
        "Valeur de l'immeuble": "1200000",
        "Nb Total Unités": "6",
      }),
      mkRow({
        "Adresse Immeuble": "200 Oak",
        "Numéro de matricule": "M2",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Valeur de l'immeuble": "800000",
        "Nb Total Unités": "4",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners, leads } = buildOwnersAndLeadsFromRole(parsed, []);
    expect(leads).toHaveLength(2);
    const ownerId = newOwners[0].id;
    for (const lead of leads) {
      expect(lead.ownerIds).toContain(ownerId);
    }
    // Numeric fields flow into the Lead.
    expect(leads[0].assessment).toBe("1200000");
    expect(leads[0].units).toBe(6);
  });

  test("filterFn excludes ineligible properties but keeps their owners", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "Big",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Valeur de l'immeuble": "5000000",
      }),
      mkRow({
        "Adresse Immeuble": "Small",
        "Numéro de matricule": "M2",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Valeur de l'immeuble": "200000",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners, leads } = buildOwnersAndLeadsFromRole(parsed, [], {
      filterFn: (p) => (p.valeurImmeuble || 0) >= 1000000,
    });
    expect(leads).toHaveLength(1);
    expect(leads[0].address).toBe("Big");
    // Owner still emitted (user filtered the leads, not the owners).
    expect(newOwners).toHaveLength(1);
    // But the owner's buildings reflect everything — we don't want to
    // lose the small property from the investor's property list.
    expect(newOwners[0].buildings.length).toBe(2);
  });

  test("building fields preserve rôle-specific numeric values", () => {
    const rows = [
      mkRow({
        "Ville": "Longueuil",
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "1234-56-7890",
        "Code Postal Immeuble": "J4K 1A1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Valeur de l'immeuble": "1200000",
        "Année de construction": "1965",
        "Nb Total Unités": "6",
        "Lat": "45.5379",
        "Lon": "-73.5118",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners } = buildOwnersAndLeadsFromRole(parsed, []);
    const [b] = newOwners[0].buildings;
    expect(b.matricule).toBe("1234-56-7890");
    expect(b.valeurImmeuble).toBe(1200000);
    expect(b.lat).toBeCloseTo(45.5379, 3);
    expect(b.lon).toBeCloseTo(-73.5118, 3);
    expect(b.city).toBe("Longueuil");
    expect(b.units).toBe(6);
  });

  test("empty parsed input returns empty lists", () => {
    const empty = buildOwnersAndLeadsFromRole({ properties: [], ownersMap: new Map() }, []);
    expect(empty.newOwners).toEqual([]);
    expect(empty.leads).toEqual([]);
    expect(empty.allOwners).toEqual([]);
  });

  test("file phones produce candidatePhones with source_column attribution on owner + lead", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0142",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners, leads } = buildOwnersAndLeadsFromRole(parsed, [], { sourceFile: "longueuil.xlsx" });
    const [owner] = newOwners;
    expect(owner.candidatePhones).toHaveLength(1);
    expect(owner.candidatePhones[0].phone).toBe("(514) 555-0142");
    expect(owner.candidatePhones[0].source).toBe("file");
    expect(owner.candidatePhones[0].source_column).toBe("Téléphone");
    expect(owner.candidatePhones[0].relationship_to_lead_owner).toBe("owner");
    expect(owner.candidatePhones[0].phone_owner_name).toBe("Jean Tremblay");
    // Lead carries the same candidate.
    expect(leads[0].candidatePhones).toHaveLength(1);
    expect(leads[0].phone).toBe("(514) 555-0142");
    expect(leads[0].phones).toContain("(514) 555-0142");
  });

  test("two slots = two phones with distinct source columns", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Propriétaire Prénom": "Jean",
        "Propriétaire Nom": "Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0142",
        "Propriétaire 2": "Marie Côté",
        "Propriétaire 2 Prénom": "Marie",
        "Propriétaire 2 Nom": "Côté",
        "Statut aux fins d'imposition scolaire 2": "Personne physique",
        "Adresse postale 2": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone 2": "514-555-0147",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const { newOwners } = buildOwnersAndLeadsFromRole(parsed, []);
    const [owner] = newOwners;
    expect(owner.candidatePhones).toHaveLength(2);
    const cols = owner.candidatePhones.map(c => c.source_column).sort();
    expect(cols).toEqual(["Téléphone", "Téléphone 2"]);
    const owners = owner.candidatePhones.map(c => c.phone_owner_name).sort();
    expect(owners).toEqual(["Jean Tremblay", "Marie Côté"]);
  });

  test("re-import does not overwrite existing file candidates with new file ones", () => {
    const rows = [
      mkRow({
        "Adresse Immeuble": "100 Elm",
        "Numéro de matricule": "M1",
        "Propriétaire": "Jean Tremblay",
        "Statut aux fins d'imposition scolaire": "Personne physique",
        "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
        "Téléphone": "514-555-0142",
      }),
    ];
    const parsed = extractRoleData({ headers, rows });
    const first = buildOwnersAndLeadsFromRole(parsed, []);
    // Re-import same file — candidate should still carry source_column.
    const second = buildOwnersAndLeadsFromRole(parsed, first.allOwners);
    const owner = second.allOwners[0];
    // Existing-merged owner must still have at least one file candidate.
    const fileCands = (owner.candidatePhones || []).filter(c => c.source === "file");
    expect(fileCands.length).toBeGreaterThan(0);
    expect(fileCands[0].source_column).toBe("Téléphone");
  });
});
