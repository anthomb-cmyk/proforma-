import {
  detectHeaders,
  detectHeadersForSlot,
  detectOwnerSlots,
  dispatchRowToLeadLike,
  parseDispatchLeadsCsv,
} from "./dispatchLeadsImport.js";
import {
  buildSearchPackages,
  auditSearchPackages,
} from "./searchPackage.js";

// All test data is synthetic. Phones use NANP-valid exchanges (777, 823, 555-01XX).

describe("detectHeaders", () => {
  test("matches French + English variants of common columns", () => {
    const map = detectHeaders([
      "Propriétaire",
      "Adresse postale",
      "Ville",
      "Code Postal",
      "Téléphone Propriétaire",
      "Téléphone Immeuble",
      "Courriel",
      "Site web",
      "Adresse Immeuble",
      "Nb Logements",
      "Statut aux fins d'imposition scolaire",
    ]);
    expect(map.lead_owner_name).toBe("Propriétaire");
    expect(map.mailing_street).toBe("Adresse postale");
    expect(map.owner_phone).toBe("Téléphone Propriétaire");
    expect(map.building_phone).toBe("Téléphone Immeuble");
    expect(map.owner_email).toBe("Courriel");
    expect(map.website).toBe("Site web");
    expect(map.property_address).toBe("Adresse Immeuble");
    expect(map.units).toBe("Nb Logements");
    expect(map.status).toBe("Statut aux fins d'imposition scolaire");
  });

  test("handles snake_case + camelCase variants", () => {
    const map = detectHeaders([
      "lead_owner_name", "mailing_address", "mailing_city",
      "owner_phone", "building_phone", "email", "website",
      "property_address", "units",
    ]);
    expect(map.lead_owner_name).toBe("lead_owner_name");
    expect(map.owner_phone).toBe("owner_phone");
    expect(map.building_phone).toBe("building_phone");
    expect(map.owner_email).toBe("email");
    expect(map.website).toBe("website");
  });

  test("does NOT collide owner_phone with building_phone", () => {
    const map = detectHeaders(["telephone_immeuble", "telephone_proprietaire"]);
    expect(map.building_phone).toBe("telephone_immeuble");
    expect(map.owner_phone).toBe("telephone_proprietaire");
  });

  test("returns empty map when no headers match", () => {
    expect(detectHeaders(["foo", "bar"])).toEqual({});
    expect(detectHeaders([])).toEqual({});
  });
});

describe("dispatchRowToLeadLike", () => {
  const baseHeaders = [
    "Propriétaire", "Adresse postale", "Ville postale", "Province", "Code postal postal",
    "Adresse Immeuble", "Ville", "Code postal immeuble",
    "Téléphone Propriétaire", "Téléphone Immeuble", "Courriel", "Site web",
    "Nb Logements", "Statut aux fins d'imposition scolaire",
  ];
  const headerMap = detectHeaders(baseHeaders);

  function mkRow(over = {}) {
    const base = Object.fromEntries(baseHeaders.map((h) => [h, ""]));
    return { ...base, ...over };
  }

  test("owner phone becomes file candidate with relationship=owner", () => {
    const lead = dispatchRowToLeadLike(mkRow({
      "Propriétaire": "ABC Immobilier Inc.",
      "Téléphone Propriétaire": "514-777-1234",
    }), headerMap);
    expect(lead.companyName).toBe("ABC Immobilier Inc.");
    expect(lead.candidatePhones).toHaveLength(1);
    expect(lead.candidatePhones[0].source).toBe("file");
    expect(lead.candidatePhones[0].relationship_to_lead_owner).toBe("owner");
    expect(lead.candidatePhones[0].source_column).toBe("Téléphone Propriétaire");
  });

  test("building phone becomes file candidate with relationship=building", () => {
    const lead = dispatchRowToLeadLike(mkRow({
      "Propriétaire": "Acme Holdings Ltd.",
      "Téléphone Immeuble": "438-823-9876",
    }), headerMap);
    const c = lead.candidatePhones.find((x) => x.source === "file");
    expect(c).toBeTruthy();
    expect(c.relationship_to_lead_owner).toBe("building");
    expect(c.source_column).toBe("Téléphone Immeuble");
  });

  test("emails + website are extracted with file source attribution", () => {
    const lead = dispatchRowToLeadLike(mkRow({
      "Propriétaire": "ABC Immobilier Inc.",
      "Courriel": "abc@example.com",
      "Site web": "https://example.com",
    }), headerMap);
    expect(lead.candidateEmails).toHaveLength(1);
    expect(lead.candidateEmails[0].email).toBe("abc@example.com");
    expect(lead.candidateEmails[0].relationship_to_lead_owner).toBe("owner");
    expect(lead.candidateWebsites).toHaveLength(1);
    expect(lead.candidateWebsites[0].website).toBe("example.com");
  });

  test("mailing_* and property_* fields are kept distinct", () => {
    const lead = dispatchRowToLeadLike(mkRow({
      "Propriétaire": "ABC Immobilier Inc.",
      "Adresse postale": "217 Saint-Jacques",
      "Ville postale": "Montréal",
      "Code postal postal": "H2Y 1M6",
      "Adresse Immeuble": "100 Elm",
      "Ville": "Longueuil",
      "Code postal immeuble": "J4K 1A1",
    }), headerMap);
    expect(lead.mailing_address).toBe("217 Saint-Jacques");
    expect(lead.mailing_city).toBe("Montréal");
    expect(lead.mailing_postal_code).toBe("H2Y 1M6");
    expect(lead.address).toBe("100 Elm");
    expect(lead.city).toBe("Longueuil");
    expect(lead.postalCode).toBe("J4K 1A1");
  });

  test("units string parses to integer; missing → 0", () => {
    const lead = dispatchRowToLeadLike(mkRow({ "Nb Logements": "12" }), headerMap);
    expect(lead.units).toBe(12);
    const empty = dispatchRowToLeadLike(mkRow({}), headerMap);
    expect(empty.units).toBe(0);
  });

  test("invalid phone values produce no candidate", () => {
    const lead = dispatchRowToLeadLike(mkRow({
      "Propriétaire": "X",
      "Téléphone Propriétaire": "garbage",
    }), headerMap);
    expect(lead.candidatePhones).toHaveLength(0);
  });
});

// Synthetic Dispatch-style CSV used by the parseDispatchLeadsCsv test +
// the integration test below. Six rows cover every case the user asked
// for (company w/ phone, numbered company w/o phone, individual with
// portfolio w/o phone, trust w/o phone, building-phone-only, email/website).
const SYNTHETIC_CSV = [
  // header
  [
    "lead_owner_name","mailing_address","mailing_city","mailing_province","mailing_postal_code",
    "property_address","property_city","property_postal_code","units",
    "owner_phone","building_phone","email","website","status",
  ].join(","),
  // 1. company w/ phone + email + website
  '"ABC Immobilier Inc.","217 Saint-Jacques","Montréal","QC","H2Y 1M6","100 Elm","Longueuil","J4K 1A1","12","514-777-1234","","abc@example.com","https://abc.com","Personne morale"',
  // 2. numbered company without phone
  '"9338-8387 QUEBEC INC.","1500 Industriel","Boucherville","QC","J4B 7K6","400 Cedar","Longueuil","J4K 1A4","16","","","","","Personne morale"',
  // 3-5. high-value individual without phone (3 properties, same mailing)
  '"Jean Tremblay","55 Pionniers","Longueuil","QC","J4M 2N3","700 Spruce","Longueuil","J4L 1B1","6","","","","","Personne physique"',
  '"Jean Tremblay","55 Pionniers","Longueuil","QC","J4M 2N3","701 Spruce","Longueuil","J4L 1B1","8","","","","","Personne physique"',
  '"Jean Tremblay","55 Pionniers","Longueuil","QC","J4M 2N3","702 Spruce","Longueuil","J4L 1B1","4","","","","","Personne physique"',
  // 6. trust / fiducie without phone
  '"Fiducie Famille Bouchard","880 Fiducie","Saint-Lambert","QC","J4P 1A1","500 Birch","Longueuil","J4K 1A5","10","","","","","Personne morale"',
  // 7. building-phone-only — owner_phone empty, building_phone populated
  '"Acme Realty Holdings Ltd.","10 Wellington","Toronto","ON","M5K 1A1","800 Taschereau","Longueuil","J4M 1C1","0","","450-823-9876","","","Personne morale"',
].join("\n");

describe("parseDispatchLeadsCsv", () => {
  test("parses synthetic CSV and detects all known headers", () => {
    const { headers, headerMap, rows } = parseDispatchLeadsCsv(SYNTHETIC_CSV);
    expect(headers).toContain("lead_owner_name");
    expect(headerMap.lead_owner_name).toBe("lead_owner_name");
    expect(headerMap.owner_phone).toBe("owner_phone");
    expect(headerMap.building_phone).toBe("building_phone");
    expect(rows).toHaveLength(7);
    expect(rows[0].companyName).toBe("ABC Immobilier Inc.");
    expect(rows[0].candidatePhones[0].source).toBe("file");
    expect(rows[0].candidatePhones[0].relationship_to_lead_owner).toBe("owner");
  });

  test("empty input yields zero rows", () => {
    const { rows } = parseDispatchLeadsCsv("");
    expect(rows).toEqual([]);
  });
});

describe("integration: synthetic CSV → buildSearchPackages → audit", () => {
  test("produces expected package + audit shape covering every required case", () => {
    const { rows } = parseDispatchLeadsCsv(SYNTHETIC_CSV);
    const packages = buildSearchPackages(rows);
    // 7 input rows but Jean Tremblay's 3 rows collapse → 5 packages.
    expect(packages).toHaveLength(5);
    const byName = Object.fromEntries(packages.map((p) => [p.lead_owner_name, p]));

    // 1. Company with phone — value=high (12 units clears the threshold),
    // search_need=low because the file phone is owner-direct.
    expect(byName["ABC Immobilier Inc."].lead_value_priority).toBe("high");
    expect(byName["ABC Immobilier Inc."].search_need_priority).toBe("low");
    expect(byName["ABC Immobilier Inc."].search_strategy).toBe("use_file_phone");
    // Email + website carried through.
    expect(byName["ABC Immobilier Inc."].existing_emails).toContain("abc@example.com");
    expect(byName["ABC Immobilier Inc."].existing_websites).toContain("abc.com");

    // 2. Numbered company without phone — searchable, mailing_address_only.
    expect(byName["9338-8387 QUEBEC INC."].is_searchable_entity).toBe(true);
    expect(byName["9338-8387 QUEBEC INC."].search_strategy).toBe("mailing_address_only");

    // 3. High-value individual: 3 properties, no phone.
    expect(byName["Jean Tremblay"].lead_value_priority).toBe("high");
    expect(byName["Jean Tremblay"].associated_properties).toHaveLength(3);
    expect(byName["Jean Tremblay"].existing_phones).toEqual([]);

    // 4. Trust / fiducie without phone.
    expect(byName["Fiducie Famille Bouchard"].legal_entity_category).toBe("trust");
    expect(byName["Fiducie Famille Bouchard"].existing_phones).toEqual([]);

    // 5. Building-phone-only — package has a phone but it's relationship=building.
    const acme = byName["Acme Realty Holdings Ltd."];
    const bldgCands = (acme.candidatePhones || []).filter((c) => c.source === "file"
      && c.relationship_to_lead_owner === "building");
    expect(bldgCands).toHaveLength(1);
    const ownerCands = (acme.candidatePhones || []).filter((c) => c.source === "file"
      && c.relationship_to_lead_owner === "owner");
    expect(ownerCands).toHaveLength(0);

    // ─ Audit ─
    const audit = auditSearchPackages(packages);
    // ABC has owner-direct file phone; Acme has only building → 1 owner-direct.
    expect(audit.with_owner_file_phone).toBe(1);
    // Numbered companies without phone → 9338-…
    expect(audit.numbered_companies_without_phone.map((p) => p.lead_owner_name))
      .toEqual(["9338-8387 QUEBEC INC."]);
    // Trusts without phone → Fiducie…
    expect(audit.trusts_without_phone.map((p) => p.lead_owner_name))
      .toEqual(["Fiducie Famille Bouchard"]);
    // High-value without any phone → Jean Tremblay (Acme excluded — has the
    // building phone, so the audit treats it as "has any phone").
    const top = audit.top_high_value_without_phone.map((p) => p.lead_owner_name);
    expect(top).toContain("Jean Tremblay");
    // Suspicious: building_phone_only flag for Acme.
    const leak = audit.suspicious.find((s) => s.kind === "building_phone_only");
    expect(leak.package.lead_owner_name).toBe("Acme Realty Holdings Ltd.");
    // Suspicious: individual_high_value flag for Jean.
    const indHigh = audit.suspicious.find((s) => s.kind === "individual_high_value");
    expect(indHigh.package.lead_owner_name).toBe("Jean Tremblay");
  });
});

describe("multi-owner detection — slot 1, 2, 3, …", () => {
  test("detectOwnerSlots returns every slot present", () => {
    expect(detectOwnerSlots([
      "Propriétaire", "Propriétaire 2", "Propriétaire 3",
      "Adresse postale", "Adresse postale 2", "Adresse postale 3",
    ])).toEqual([1, 2, 3]);
  });

  test("detectHeadersForSlot returns per-slot per-owner fields + shared row fields", () => {
    const headers = [
      "Propriétaire", "Propriétaire 2",
      "Adresse postale", "Adresse postale 2",
      "Téléphone Propriétaire", "Téléphone Propriétaire 2",
      "Adresse Immeuble", "Nb Logements",
      "Téléphone Immeuble",
    ];
    const slot1 = detectHeadersForSlot(headers, 1);
    const slot2 = detectHeadersForSlot(headers, 2);
    expect(slot1.lead_owner_name).toBe("Propriétaire");
    expect(slot2.lead_owner_name).toBe("Propriétaire 2");
    expect(slot1.mailing_street).toBe("Adresse postale");
    expect(slot2.mailing_street).toBe("Adresse postale 2");
    // Per-owner phones split by slot.
    expect(slot1.owner_phone).toBe("Téléphone Propriétaire");
    expect(slot2.owner_phone).toBe("Téléphone Propriétaire 2");
    // Row-level fields are inherited from slot 1 for every slot.
    expect(slot1.property_address).toBe("Adresse Immeuble");
    expect(slot2.property_address).toBe("Adresse Immeuble");
    expect(slot1.units).toBe("Nb Logements");
    expect(slot2.units).toBe("Nb Logements");
    expect(slot1.building_phone).toBe("Téléphone Immeuble");
    expect(slot2.building_phone).toBe("Téléphone Immeuble");
  });

  test("one CSV row with two owners → two lead-like records, each carrying the other as alias", () => {
    const CSV = [
      "Propriétaire,Propriétaire 2,Adresse postale,Adresse postale 2,Téléphone Propriétaire,Téléphone Propriétaire 2,Adresse Immeuble,Nb Logements,Téléphone Immeuble",
      '"Jean Tremblay","Marie Côté","217 Saint-Jacques, Montréal","217 Saint-Jacques, Montréal","514-777-1234","","100 Elm","6","450-823-9876"',
    ].join("\n");
    const { rows, slots } = parseDispatchLeadsCsv(CSV);
    expect(slots).toEqual([1, 2]);
    expect(rows).toHaveLength(2);

    const jean = rows.find((r) => r.companyName === "Jean Tremblay");
    const marie = rows.find((r) => r.companyName === "Marie Côté");
    // Jean has his own owner phone; Marie has none.
    expect(jean.candidatePhones.find((c) => c.relationship_to_lead_owner === "owner").phone)
      .toBe("(514) 777-1234");
    expect(marie.candidatePhones.filter((c) => c.relationship_to_lead_owner === "owner")).toEqual([]);
    // Building phone is row-level → shared between the two records.
    for (const r of rows) {
      expect(r.candidatePhones.find((c) => c.relationship_to_lead_owner === "building").phone)
        .toBe("(450) 823-9876");
    }
    // Each record carries the OTHER owner as a co-owner alias.
    expect(jean.aliases).toContain("Marie Côté");
    expect(marie.aliases).toContain("Jean Tremblay");
  });
});

describe("address-aware duplicates via Dispatch CSV", () => {
  test("same name + same mailing across two rows → 1 package, no flag", () => {
    const CSV = [
      "lead_owner_name,mailing_address,mailing_city,mailing_postal_code,property_address,units",
      '"ABC Immobilier Inc.","217 Saint-Jacques","Montréal","H2Y 1M6","100 Elm","6"',
      '"ABC Immobilier Inc.","217 Saint-Jacques","Montréal","H2Y 1M6","200 Oak","8"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0].associated_properties).toHaveLength(2);
    expect(pkgs[0].duplicate_different_address).toBe(false);
    const audit = auditSearchPackages(pkgs);
    expect(audit.duplicate_different_address).toEqual([]);
    // No suspicious split flag either.
    expect(audit.suspicious.find((s) => s.kind === "dup_split_by_name")).toBeUndefined();
  });

  test("same name + DIFFERENT mailing → 2 packages, duplicate_different_address=true on both", () => {
    const CSV = [
      "lead_owner_name,mailing_address,mailing_city,mailing_postal_code,property_address,units",
      '"ABC Immobilier Inc.","217 Saint-Jacques","Montréal","H2Y 1M6","100 Elm","6"',
      '"ABC Immobilier Inc.","999 Other","Laval","H7A 1A1","200 Oak","8"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    expect(pkgs).toHaveLength(2);
    for (const p of pkgs) {
      expect(p.duplicate_different_address).toBe(true);
      expect(p.address_variant_packages).toHaveLength(1);
    }
    const audit = auditSearchPackages(pkgs);
    expect(audit.duplicate_different_address).toHaveLength(2);
    // Audit doesn't classify these as suspicious.
    const susp = audit.suspicious.map((s) => s.kind);
    expect(susp).not.toContain("dup_split_by_name");
    expect(susp).not.toContain("duplicate_different_address");
  });

  test("multi-owner row + same-mailing collapse: one package per distinct owner, none flagged dup", () => {
    const CSV = [
      "Propriétaire,Propriétaire 2,Adresse postale,Adresse postale 2,Téléphone Propriétaire,Adresse Immeuble,Nb Logements",
      '"Jean Tremblay","Marie Côté","217 Saint-Jacques, Montréal","217 Saint-Jacques, Montréal","514-777-1234","100 Elm","6"',
      '"Jean Tremblay","Marie Côté","217 Saint-Jacques, Montréal","217 Saint-Jacques, Montréal","514-777-1234","200 Oak","8"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    // Jean and Marie are distinct names → two packages.
    expect(pkgs).toHaveLength(2);
    const jean = pkgs.find((p) => p.lead_owner_name === "Jean Tremblay");
    const marie = pkgs.find((p) => p.lead_owner_name === "Marie Côté");
    expect(jean).toBeTruthy();
    expect(marie).toBeTruthy();
    // Both rows merge into each owner's package: 2 properties each.
    expect(jean.associated_properties).toHaveLength(2);
    expect(marie.associated_properties).toHaveLength(2);
    // Co-owners preserved on each package.
    expect(jean.co_owners).toContain("Marie Côté");
    expect(marie.co_owners).toContain("Jean Tremblay");
    // Same-mailing across rows → no dup_diff_addr flag.
    expect(jean.duplicate_different_address).toBe(false);
    expect(marie.duplicate_different_address).toBe(false);
  });

  test("numbered companies + multi-owner: each numbered name remains searchable", () => {
    const CSV = [
      "Propriétaire,Propriétaire 2,Adresse postale,Adresse postale 2,Adresse Immeuble,Nb Logements",
      '"9338-8387 QUEBEC INC.","9111-1111 CANADA INC.","1500 Industriel, Boucherville","1500 Industriel, Boucherville","100 Elm","12"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    expect(pkgs).toHaveLength(2);
    for (const p of pkgs) {
      expect(p.legal_entity_category).toBe("numbered_company");
      expect(p.is_searchable_entity).toBe(true);
      expect(p.search_strategy).toBe("mailing_address_only");
    }
  });

  test("multi-property individual stays high-value across multi-owner rows", () => {
    const CSV = [
      "Propriétaire,Propriétaire 2,Adresse postale,Adresse postale 2,Adresse Immeuble,Nb Logements",
      '"Jean Tremblay","Marie Côté","55 Pionniers, Longueuil","55 Pionniers, Longueuil","700 Spruce","6"',
      '"Jean Tremblay","Marie Côté","55 Pionniers, Longueuil","55 Pionniers, Longueuil","701 Spruce","8"',
      '"Jean Tremblay","Marie Côté","55 Pionniers, Longueuil","55 Pionniers, Longueuil","702 Spruce","4"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    const jean = pkgs.find((p) => p.lead_owner_name === "Jean Tremblay");
    expect(jean.legal_entity_category).toBe("individual");
    expect(jean.lead_value_priority).toBe("high");
    expect(jean.associated_properties).toHaveLength(3);
  });

  test("file owner phone/email/website preserved on per-slot records", () => {
    const CSV = [
      "Propriétaire,Propriétaire 2,Téléphone Propriétaire,Téléphone Propriétaire 2,Courriel,Courriel 2,Site web,Adresse postale,Adresse postale 2,Adresse Immeuble",
      '"Jean Tremblay","Marie Côté","514-777-1234","438-823-9876","jean@x.com","marie@y.com","https://x.com","217 Saint-Jacques, Montréal","217 Saint-Jacques, Montréal","100 Elm"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    const jean = pkgs.find((p) => p.lead_owner_name === "Jean Tremblay");
    const marie = pkgs.find((p) => p.lead_owner_name === "Marie Côté");
    // Each owner's own phone is owner-relationship.
    const jeanOwn = jean.candidatePhones.find((c) =>
      c.source === "file" && c.relationship_to_lead_owner === "owner");
    const marieOwn = marie.candidatePhones.find((c) =>
      c.source === "file" && c.relationship_to_lead_owner === "owner");
    expect(jeanOwn.phone).toBe("(514) 777-1234");
    expect(marieOwn.phone).toBe("(438) 823-9876");
    // Each owner has their own email.
    expect(jean.existing_emails).toContain("jean@x.com");
    expect(marie.existing_emails).toContain("marie@y.com");
    // Website was on slot 1 only — Jean has it, Marie doesn't.
    expect(jean.existing_websites).toContain("x.com");
    expect(marie.existing_websites).toEqual([]);
  });

  test("building phone shared across multi-owner rows stays building-relationship", () => {
    const CSV = [
      "Propriétaire,Propriétaire 2,Téléphone Immeuble,Adresse postale,Adresse postale 2,Adresse Immeuble",
      '"Jean Tremblay","Marie Côté","450-823-9876","217 Saint-Jacques, Montréal","217 Saint-Jacques, Montréal","100 Elm"',
    ].join("\n");
    const { rows } = parseDispatchLeadsCsv(CSV);
    const pkgs = buildSearchPackages(rows);
    for (const p of pkgs) {
      const bldg = p.candidatePhones.find((c) =>
        c.source === "file" && c.relationship_to_lead_owner === "building");
      expect(bldg).toBeTruthy();
      expect(bldg.phone).toBe("(450) 823-9876");
      const ownerCands = p.candidatePhones.filter((c) =>
        c.source === "file" && c.relationship_to_lead_owner === "owner");
      expect(ownerCands).toEqual([]);
    }
    // Audit catches both owners as building_phone_only.
    const audit = auditSearchPackages(pkgs);
    const leak = audit.suspicious.filter((s) => s.kind === "building_phone_only");
    expect(leak).toHaveLength(2);
  });
});
