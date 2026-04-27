import {
  detectHeaders,
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
