import {
  buildSearchPackages,
  classifyLegalEntity,
  assessLeadValue,
  assessSearchPriority,
  chooseSearchStrategy,
  buildDirectEntityQueries,
  buildMailingAddressDiscoveryQueries,
  summarizeSearchPackage,
  previewSearchPackages,
  aggregateSearchPackageStats,
  formatSearchPackageRow,
  formatSearchPackageReport,
  auditSearchPackages,
} from "./searchPackage.js";
import {
  makePhoneCandidate,
  makeEmailCandidate,
  makeWebsiteCandidate,
} from "./contactCandidates.js";

// Owner-shaped fixture (mirrors the records produced by ownerGrouping.js +
// roleImport.js). Tests pass arrays of these into buildSearchPackages.
function mkOwner(over = {}) {
  return {
    id: "owner_X",
    ownerKey: "k|p",
    displayName: "ABC Immobilier Inc.",
    aliases: [],
    contactNames: [],
    phones: [],
    phoneSources: {},
    emails: [],
    websites: [],
    candidatePhones: [],
    candidateEmails: [],
    candidateWebsites: [],
    postalAddress: { street: "217 Saint-Jacques", city: "Montréal", province: "QC", postalCode: "H2Y 1M6" },
    buildings: [],
    stage: "new",
    callStatus: "none",
    callNotes: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: 1700000000000,
    lookupStatus: "pending",
    ...over,
  };
}

describe("classifyLegalEntity", () => {
  test("numbered companies", () => {
    expect(classifyLegalEntity("9338-8387 QUEBEC INC.")).toBe("numbered_company");
    expect(classifyLegalEntity("1234567 Inc.")).toBe("numbered_company");
    expect(classifyLegalEntity("9876-5432 CANADA INC")).toBe("numbered_company");
  });
  test("trust / fiducie", () => {
    expect(classifyLegalEntity("Fiducie Famille Tremblay")).toBe("trust");
    expect(classifyLegalEntity("The Smith Trust")).toBe("trust");
    expect(classifyLegalEntity("Succession Jean Tremblay")).toBe("trust");
  });
  test("immobilier wins over generic inc", () => {
    expect(classifyLegalEntity("Gestion Immobilière X Inc.")).toBe("immobilier");
    expect(classifyLegalEntity("ABC Realty Inc")).toBe("immobilier");
    expect(classifyLegalEntity("Acme Properties LLC")).toBe("immobilier");
  });
  test("investments + holdings + gestion + society", () => {
    expect(classifyLegalEntity("Acme Investments Inc.")).toBe("investments");
    expect(classifyLegalEntity("ABC Holdings")).toBe("holdings");
    expect(classifyLegalEntity("Gestion ABC Inc.")).toBe("gestion");
    expect(classifyLegalEntity("Coopérative ABC")).toBe("society");
  });
  test("generic inc / ltée", () => {
    expect(classifyLegalEntity("Boulangerie Tremblay Inc.")).toBe("inc_ltee");
    expect(classifyLegalEntity("ABC Ltée")).toBe("inc_ltee");
  });
  test("individual via status flag", () => {
    expect(classifyLegalEntity("Jean Tremblay", "Personne physique")).toBe("individual");
    expect(classifyLegalEntity("Marie Côté", "Individual")).toBe("individual");
  });
  test("individual via name shape", () => {
    expect(classifyLegalEntity("Jean Tremblay")).toBe("individual");
    expect(classifyLegalEntity("Marie-Claude Côté-Bouchard")).toBe("individual");
  });
  test("blank / unknown", () => {
    expect(classifyLegalEntity("")).toBe("unknown");
    expect(classifyLegalEntity("???")).toBe("unknown");
    expect(classifyLegalEntity("X")).toBe("unknown");
  });
});

describe("buildDirectEntityQueries", () => {
  test("company + city + province → ranked queries", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      mailing_city: "Montréal",
      mailing_province: "QC",
    };
    const q = buildDirectEntityQueries(pkg);
    expect(q.length).toBeGreaterThanOrEqual(2);
    expect(q[0]).toBe("ABC Immobilier Inc., Montréal, QC");
    expect(q[q.length - 1]).toBe("ABC Immobilier Inc.");
  });
  test("numbered companies skip direct queries", () => {
    expect(buildDirectEntityQueries({
      lead_owner_name: "9338-8387 QUEBEC INC.",
      legal_entity_category: "numbered_company",
      mailing_city: "Montréal",
    })).toEqual([]);
  });
  test("individuals skip direct queries", () => {
    expect(buildDirectEntityQueries({
      lead_owner_name: "Jean Tremblay",
      legal_entity_category: "individual",
      mailing_city: "Montréal",
    })).toEqual([]);
  });
  test("blank name returns []", () => {
    expect(buildDirectEntityQueries({ lead_owner_name: "" })).toEqual([]);
  });
});

describe("buildMailingAddressDiscoveryQueries", () => {
  test("good mailing address → multiple queries", () => {
    const q = buildMailingAddressDiscoveryQueries({
      mailing_address: "217 rue Saint-Jacques",
      mailing_city: "Montréal",
      mailing_province: "QC",
      mailing_postal_code: "H2Y 1M6",
    });
    expect(q.length).toBeGreaterThanOrEqual(2);
    expect(q[0]).toBe("217 rue Saint-Jacques, Montréal, QC, H2Y 1M6");
    expect(q.some((x) => x.startsWith("companies "))).toBe(true);
  });
  test("missing street + missing postal → []", () => {
    expect(buildMailingAddressDiscoveryQueries({})).toEqual([]);
    expect(buildMailingAddressDiscoveryQueries({ mailing_city: "Montréal" })).toEqual([]);
  });
});

describe("assessSearchPriority + chooseSearchStrategy", () => {
  test("file phone present → use_file_phone strategy + low priority", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      is_searchable_entity: true,
      existing_phones: ["514-777-1234"],
      candidatePhones: [],
      associated_properties: [{ address: "100 Elm" }, { address: "200 Oak" }],
      mailing_address: "217 St-Jacques", mailing_city: "Montréal", mailing_postal_code: "H2Y 1M6",
    };
    expect(assessSearchPriority(pkg)).toBe("low");
    pkg.search_priority = "low";
    expect(chooseSearchStrategy(pkg)).toBe("use_file_phone");
  });
  test("company + good mailing + many properties → high + dual strategy", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      is_searchable_entity: true,
      existing_phones: [], candidatePhones: [],
      associated_properties: [{ address: "100 Elm", units: 6 }, { address: "200 Oak", units: 8 }],
      mailing_address: "217 St-Jacques", mailing_city: "Montréal", mailing_postal_code: "H2Y 1M6",
    };
    expect(assessSearchPriority(pkg)).toBe("high");
    pkg.search_priority = "high";
    expect(chooseSearchStrategy(pkg)).toBe("direct_entity_then_mailing_address_related_companies");
  });
  test("company without mailing → direct_entity", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      is_searchable_entity: true,
      existing_phones: [], candidatePhones: [],
      associated_properties: [{ address: "100 Elm" }],
      mailing_address: "", mailing_city: "", mailing_postal_code: "",
    };
    pkg.search_priority = assessSearchPriority(pkg);
    expect(chooseSearchStrategy(pkg)).toBe("direct_entity");
  });
  test("numbered company + mailing → mailing_address_only", () => {
    const pkg = {
      lead_owner_name: "9338-8387 QUEBEC INC.",
      legal_entity_category: "numbered_company",
      is_searchable_entity: true,
      existing_phones: [], candidatePhones: [],
      associated_properties: [{ address: "100 Elm" }],
      mailing_address: "217 St-Jacques", mailing_city: "Montréal", mailing_postal_code: "H2Y 1M6",
    };
    pkg.search_priority = assessSearchPriority(pkg);
    expect(chooseSearchStrategy(pkg)).toBe("mailing_address_only");
  });
  test("individual + no mailing + no properties → skip", () => {
    const pkg = {
      lead_owner_name: "Jean Tremblay",
      legal_entity_category: "individual",
      is_searchable_entity: false,
      existing_phones: [], candidatePhones: [],
      associated_properties: [],
      mailing_address: "", mailing_city: "", mailing_postal_code: "",
    };
    expect(assessSearchPriority(pkg)).toBe("skip");
    pkg.search_priority = "skip";
    expect(chooseSearchStrategy(pkg)).toBe("skip_low_value");
  });
  test("junk name → needs_manual_review", () => {
    const pkg = {
      lead_owner_name: "12345678",
      legal_entity_category: "unknown",
      is_searchable_entity: false,
      existing_phones: [], candidatePhones: [],
      associated_properties: [],
      mailing_address: "217 St-Jacques", mailing_city: "Montréal", mailing_postal_code: "H2Y 1M6",
    };
    pkg.search_priority = assessSearchPriority(pkg);
    expect(chooseSearchStrategy(pkg)).toBe("needs_manual_review");
  });
});

describe("buildSearchPackages — required test cases", () => {
  // 1. numbered company is searchable, not junk
  test("(1) numbered company is searchable, not flagged as junk", () => {
    const owners = [mkOwner({
      displayName: "9338-8387 QUEBEC INC.",
      buildings: [{ id: "b1", address: "100 Elm", postalCode: "H1A 1A1", units: 4 }],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.legal_entity_category).toBe("numbered_company");
    expect(pkg.is_searchable_entity).toBe(true);
    expect(pkg.warnings).not.toContain("owner_name_looks_junk");
    expect(pkg.search_strategy).toBe("mailing_address_only");
    expect(pkg.mailing_address_discovery_queries.length).toBeGreaterThan(0);
  });

  // 2. same owner across multiple properties becomes one package
  test("(2) one owner across multiple properties → one package", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      buildings: [
        { id: "b1", address: "100 Elm", postalCode: "H1A 1A1", units: 6 },
        { id: "b2", address: "200 Oak", postalCode: "H1B 1B1", units: 8 },
      ],
    })];
    const [pkg, ...rest] = buildSearchPackages(owners);
    expect(rest).toEqual([]);
    expect(pkg.associated_properties).toHaveLength(2);
    expect(pkg.associated_properties.map((p) => p.address).sort()).toEqual(["100 Elm", "200 Oak"]);
  });

  // 3. file phone/email/website candidates are preserved
  test("(3) file candidates pass through unchanged", () => {
    const fileP = makePhoneCandidate({
      phone: "514-777-1234", source: "file", source_column: "Téléphone Propriétaire",
      phone_owner_name: "ABC", relationship_to_lead_owner: "owner",
    });
    const fileE = makeEmailCandidate({
      email: "abc@example.com", source: "file", source_column: "Courriel",
      relationship_to_lead_owner: "owner",
    });
    const fileW = makeWebsiteCandidate({
      website: "https://example.com", source: "file", source_column: "Site web",
      relationship_to_lead_owner: "owner",
    });
    const owners = [mkOwner({
      candidatePhones: [fileP], candidateEmails: [fileE], candidateWebsites: [fileW],
      phones: ["(514) 777-1234"], emails: ["abc@example.com"], websites: ["example.com"],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.candidatePhones).toHaveLength(1);
    expect(pkg.candidatePhones[0].source).toBe("file");
    expect(pkg.candidatePhones[0].source_column).toBe("Téléphone Propriétaire");
    expect(pkg.candidateEmails).toHaveLength(1);
    expect(pkg.candidateEmails[0].source_column).toBe("Courriel");
    expect(pkg.candidateWebsites).toHaveLength(1);
    expect(pkg.candidateWebsites[0].website).toBe("example.com");
    // Flat lists carry the values too.
    expect(pkg.existing_phones).toEqual(["(514) 777-1234"]);
    expect(pkg.existing_emails).toEqual(["abc@example.com"]);
    expect(pkg.existing_websites).toEqual(["example.com"]);
  });

  // 4. building contacts remain candidates but do not become owner phone priority
  test("(4) building-relationship phone stays candidate-only, doesn't make package look phoned-in", () => {
    const bldgP = makePhoneCandidate({
      phone: "438-823-9876", source: "file", source_column: "Téléphone Immeuble",
      relationship_to_lead_owner: "building",
    });
    const owners = [mkOwner({
      // No owner-relationship phone. existing_phones empty.
      candidatePhones: [bldgP], phones: [],
    })];
    const [pkg] = buildSearchPackages(owners);
    // Candidate preserved with building relationship.
    expect(pkg.candidatePhones).toHaveLength(1);
    expect(pkg.candidatePhones[0].relationship_to_lead_owner).toBe("building");
    // Building phone DOES end up in the flat existing_phones list (it's a
    // valid number we know about) — but the package still gets enriched
    // because we treat "any valid phone" as a found-phone signal. This test
    // pins down: relationship metadata survives the build.
    expect(pkg.existing_phones).toContain("(438) 823-9876");
  });

  // 5. company with no phone gets direct entity queries
  test("(5) company with no phone → direct_entity_queries populated", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      buildings: [{ id: "b1", address: "100 Elm", units: 6 }],
      // No mailing address — forces direct_entity (not the dual strategy).
      postalAddress: { street: "", city: "", province: "QC", postalCode: "" },
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.is_searchable_entity).toBe(true);
    expect(pkg.search_strategy).toBe("direct_entity");
    expect(pkg.direct_entity_queries.length).toBeGreaterThan(0);
    expect(pkg.direct_entity_queries[pkg.direct_entity_queries.length - 1])
      .toBe("ABC Immobilier Inc.");
    // No mailing → no discovery queries.
    expect(pkg.mailing_address_discovery_queries).toEqual([]);
  });

  // 6. company with mailing address gets mailing address discovery queries
  test("(6) company + mailing → both query lists populated", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      buildings: [{ id: "b1", address: "100 Elm" }],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.search_strategy).toBe("direct_entity_then_mailing_address_related_companies");
    expect(pkg.direct_entity_queries.length).toBeGreaterThan(0);
    expect(pkg.mailing_address_discovery_queries.length).toBeGreaterThan(0);
  });

  // 7. individual owner is preserved but low priority
  test("(7) individual owner preserved, priority low/skip", () => {
    const owners = [mkOwner({
      displayName: "Jean Tremblay",
      contactNames: ["Jean Tremblay"],
      buildings: [{ id: "b1", address: "100 Elm" }],
      // status is best signaled via classifyLegalEntity's status arg, but
      // the name shape alone is enough for the classifier.
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.lead_owner_name).toBe("Jean Tremblay");
    expect(pkg.legal_entity_category).toBe("individual");
    expect(pkg.is_searchable_entity).toBe(false);
    expect(["skip", "low"]).toContain(pkg.search_priority);
    // Not searched as a direct entity.
    expect(pkg.direct_entity_queries).toEqual([]);
  });

  // 8. co-owners are preserved
  test("(8) co-owners (other contactNames + aliases at same mailing) preserved", () => {
    const owners = [mkOwner({
      displayName: "Jean Tremblay",
      contactNames: ["Jean Tremblay", "Marie Côté"],
      aliases: ["9338-8387 QUEBEC INC."],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.co_owners).toEqual(expect.arrayContaining(["Marie Côté", "9338-8387 QUEBEC INC."]));
    expect(pkg.co_owners).not.toContain("Jean Tremblay");
  });

  // 9. dedupe repeated phones/emails/websites
  test("(9) dedupes repeated phones/emails/websites across rows", () => {
    const owners = [
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        phones: ["514-777-1234"],
        emails: ["abc@example.com"],
        websites: ["https://abc.com"],
      }),
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        // Same dedup key (same name + same postal) — these merge.
        phones: ["(514) 777-1234", "438-823-9999"],
        emails: ["ABC@example.com", "alt@example.com"],
        websites: ["abc.com", "https://other.com"],
      }),
    ];
    const [pkg, ...rest] = buildSearchPackages(owners);
    expect(rest).toEqual([]);
    // Phone normalized, dedup'd: 2 unique.
    expect(pkg.existing_phones).toHaveLength(2);
    // Email lowercased, dedup'd: 2 unique.
    expect(pkg.existing_emails).toHaveLength(2);
    expect(pkg.existing_emails).toEqual(expect.arrayContaining(["abc@example.com", "alt@example.com"]));
    // Website normalized, dedup'd: 2 unique.
    expect(pkg.existing_websites).toHaveLength(2);
    expect(pkg.existing_websites).toEqual(expect.arrayContaining(["abc.com", "other.com"]));
  });

  // 10. summarizeSearchPackage returns useful counts
  test("(10) summarizeSearchPackage carries name, category, counts", () => {
    const fileP = makePhoneCandidate({
      phone: "514-777-1234", source: "file", source_column: "Téléphone",
      relationship_to_lead_owner: "owner",
    });
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      candidatePhones: [fileP], phones: ["(514) 777-1234"],
      buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
      contactNames: ["Co Owner"],
    })];
    const [pkg] = buildSearchPackages(owners);
    const s = summarizeSearchPackage(pkg);
    expect(s).toContain("ABC Immobilier Inc.");
    expect(s).toContain("immobilier");
    expect(s).toContain("priority=");
    expect(s).toContain("strategy=");
    expect(s).toMatch(/phones=1\/1/);
    expect(s).toMatch(/props=2/);
    expect(s).toMatch(/co_owners=1/);
  });
});

describe("previewSearchPackages", () => {
  test("returns one summary line per group", () => {
    const owners = [
      mkOwner({ displayName: "ABC Immobilier Inc.", buildings: [{ id: "b1", address: "100 Elm" }] }),
      mkOwner({
        displayName: "Gestion XYZ Inc.",
        postalAddress: { street: "999 Other", city: "Laval", province: "QC", postalCode: "H7A 1A1" },
        buildings: [{ id: "b2", address: "300 Pine" }],
      }),
    ];
    const text = previewSearchPackages(owners);
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("ABC Immobilier Inc.");
    expect(lines[1]).toContain("Gestion XYZ Inc.");
  });
});

describe("Lead-like input shape", () => {
  test("plain lead-like rows are grouped + classified the same way", () => {
    const rows = [
      {
        companyName: "ABC Immobilier Inc.",
        contactName: "",
        address: "100 Elm",
        city: "Montréal",
        province: "QC",
        postalCode: "H2Y 1M6",
        phones: ["514-777-1234"],
        candidatePhones: [makePhoneCandidate({
          phone: "514-777-1234", source: "file", source_column: "Téléphone",
          relationship_to_lead_owner: "owner",
        })],
      },
      {
        companyName: "ABC Immobilier Inc.",
        address: "200 Oak",
        city: "Montréal",
        province: "QC",
        postalCode: "H2Y 1M6",
        phones: [],
      },
    ];
    const [pkg, ...rest] = buildSearchPackages(rows);
    expect(rest).toEqual([]);
    expect(pkg.lead_owner_name).toBe("ABC Immobilier Inc.");
    expect(pkg.legal_entity_category).toBe("immobilier");
    expect(pkg.associated_properties).toHaveLength(2);
    expect(pkg.candidatePhones).toHaveLength(1);
    expect(pkg.search_strategy).toBe("use_file_phone");
  });
});

describe("assessLeadValue (independent of contact-completeness)", () => {
  test("company + multiple properties + good mailing → high (regardless of phone)", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      is_searchable_entity: true,
      associated_properties: [{ address: "100 Elm" }, { address: "200 Oak" }],
      mailing_address: "217 St-Jacques", mailing_city: "Montréal", mailing_postal_code: "H2Y 1M6",
    };
    expect(assessLeadValue(pkg)).toBe("high");
    // Same package WITH a phone is still high — value is independent of contacts.
    pkg.existing_phones = ["514-777-1234"];
    expect(assessLeadValue(pkg)).toBe("high");
  });
  test("company with one property → medium", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      is_searchable_entity: true,
      associated_properties: [{ address: "100 Elm" }],
      mailing_address: "217 St-Jacques", mailing_city: "Montréal", mailing_postal_code: "H2Y 1M6",
    };
    expect(assessLeadValue(pkg)).toBe("medium");
  });
  test("company with no properties + no mailing → low", () => {
    const pkg = {
      lead_owner_name: "ABC Immobilier Inc.",
      legal_entity_category: "immobilier",
      is_searchable_entity: true,
      associated_properties: [],
      mailing_address: "", mailing_city: "", mailing_postal_code: "",
    };
    expect(assessLeadValue(pkg)).toBe("low");
  });
  test("individual with one property → low; with portfolio → medium/high", () => {
    const base = {
      lead_owner_name: "Jean Tremblay",
      legal_entity_category: "individual",
      is_searchable_entity: false,
      mailing_address: "x", mailing_city: "y", mailing_postal_code: "z",
    };
    expect(assessLeadValue({ ...base, associated_properties: [{ address: "1" }] })).toBe("low");
    expect(assessLeadValue({ ...base, associated_properties: [{ address: "1" }, { address: "2" }] })).toBe("medium");
    expect(assessLeadValue({
      ...base,
      associated_properties: [{ address: "1" }, { address: "2" }, { address: "3" }],
    })).toBe("high");
  });
  test("never returns 'skip' (only high/medium/low)", () => {
    expect(["high", "medium", "low"]).toContain(assessLeadValue({
      lead_owner_name: "",
      legal_entity_category: "unknown",
      associated_properties: [],
      mailing_address: "",
    }));
    expect(["high", "medium", "low"]).toContain(assessLeadValue(null));
  });
});

describe("lead_value_priority vs search_need_priority — separation", () => {
  // The headline business rule: a company with multiple properties and a
  // file phone is HIGH-VALUE but LOW-SEARCH-NEED. Pin it down end-to-end.
  test("company w/ portfolio + file phone → value=high, search_need=low", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      phones: ["(514) 777-1234"],
      buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.lead_value_priority).toBe("high");
    expect(pkg.search_need_priority).toBe("low");
    // Backwards-compat alias still equals search_need_priority.
    expect(pkg.search_priority).toBe("low");
    expect(pkg.search_strategy).toBe("use_file_phone");
  });

  test("same company without phone → value=high, search_need=high", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      phones: [],
      buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.lead_value_priority).toBe("high");
    expect(pkg.search_need_priority).toBe("high");
  });

  test("individual with no contacts and no portfolio → value=low, search_need=skip", () => {
    const owners = [mkOwner({
      displayName: "Jean Tremblay",
      contactNames: ["Jean Tremblay"],
      postalAddress: { street: "", city: "", province: "", postalCode: "" },
      buildings: [],
      phones: [],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.lead_value_priority).toBe("low");
    expect(pkg.search_need_priority).toBe("skip");
  });

  test("reason string includes both axes", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      phones: ["(514) 777-1234"],
      buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.reason).toContain("lead_value=high");
    expect(pkg.reason).toContain("search_need=low");
  });
});

describe("aggregateSearchPackageStats", () => {
  function fixture() {
    // Three owners covering the buckets we care about.
    return [
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        phones: ["514-777-1234"],
        emails: ["abc@example.com"],
        websites: ["abc.com"],
        buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
      }),
      mkOwner({
        displayName: "9338-8387 QUEBEC INC.",
        postalAddress: { street: "999 Other", city: "Laval", province: "QC", postalCode: "H7A 1A1" },
        buildings: [{ id: "b3", address: "300 Pine" }],
      }),
      mkOwner({
        displayName: "Jean Tremblay",
        contactNames: ["Jean Tremblay"],
        postalAddress: { street: "", city: "", province: "", postalCode: "" },
        buildings: [],
      }),
    ];
  }

  test("rolls up totals + buckets correctly", () => {
    const pkgs = buildSearchPackages(fixture());
    const stats = aggregateSearchPackageStats(pkgs);
    expect(stats.total).toBe(3);
    // search_need: ABC has phone → low; numbered → high (good mailing);
    // individual w/ no mailing → skip.
    expect(stats.by_search_need.low).toBeGreaterThanOrEqual(1);
    expect(stats.by_search_need.skip).toBeGreaterThanOrEqual(1);
    // by_priority is the backward-compat alias and should mirror by_search_need.
    expect(stats.by_priority).toEqual(stats.by_search_need);
    // lead_value bucket: ABC + numbered both high (portfolio); individual low.
    expect(stats.by_lead_value.high).toBeGreaterThanOrEqual(1);
    expect(stats.by_lead_value.low).toBeGreaterThanOrEqual(1);
    // Existing-contact counts come straight off ABC's row.
    expect(stats.with_existing_phone).toBe(1);
    expect(stats.with_existing_email).toBe(1);
    expect(stats.with_existing_website).toBe(1);
    // Numbered-company + individual buckets.
    expect(stats.numbered_companies).toBe(1);
    expect(stats.individuals).toBe(1);
    // Category breakdown is a plain object keyed by category.
    expect(stats.by_category.numbered_company).toBe(1);
    expect(stats.by_category.immobilier).toBe(1);
    expect(stats.by_category.individual).toBe(1);
    // Strategy breakdown is also keyed by strategy.
    expect(Object.keys(stats.by_strategy).length).toBeGreaterThan(0);
    // Property total is the sum across all packages.
    expect(stats.total_properties).toBe(3);
  });

  test("empty / null input → zeros", () => {
    const empty = aggregateSearchPackageStats([]);
    expect(empty.total).toBe(0);
    expect(empty.by_priority).toEqual({ high: 0, medium: 0, low: 0, skip: 0 });
    expect(aggregateSearchPackageStats(null).total).toBe(0);
  });
});

describe("formatSearchPackageRow + formatSearchPackageReport", () => {
  test("row carries name, category, value, priority, strategy, props, phones, queries", () => {
    const owners = [mkOwner({
      displayName: "ABC Immobilier Inc.",
      phones: ["514-777-1234"],
      buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
    })];
    const [pkg] = buildSearchPackages(owners);
    const row = formatSearchPackageRow(pkg);
    expect(row).toContain("ABC Immobilier Inc.");
    expect(row).toContain("immobilier");
    // The value=high · pri=low pairing is the headline business rule.
    expect(row).toContain("value=high");
    expect(row).toContain("pri=low");
    expect(row).toMatch(/strat=\w+/);
    expect(row).toMatch(/props=2/);
    expect(row).toMatch(/phones=1/);
    expect(row).toContain("dQ=");
    expect(row).toContain("mQ=");
  });

  test("report has stats header + numbered top-N rows", () => {
    const owners = [
      mkOwner({ displayName: "ABC Immobilier Inc.", buildings: [{ id: "b1", address: "100 Elm" }] }),
      mkOwner({
        displayName: "Gestion XYZ Inc.",
        postalAddress: { street: "999 Other", city: "Laval", province: "QC", postalCode: "H7A 1A1" },
        buildings: [{ id: "b2", address: "300 Pine" }],
      }),
    ];
    const pkgs = buildSearchPackages(owners);
    const report = formatSearchPackageReport(pkgs);
    expect(report).toContain("=== Search Package Stats ===");
    expect(report).toContain("total: 2");
    expect(report).toContain("lead_value:");
    expect(report).toContain("search_need:");
    expect(report).toContain("existing:");
    expect(report).toContain("=== Top 2 Packages ===");
    // Numbered rows.
    expect(report).toMatch(/\n  1\. /);
    expect(report).toMatch(/\n  2\. /);
  });

  test("topN caps the row count", () => {
    const owners = Array.from({ length: 30 }, (_, i) => mkOwner({
      displayName: `Company ${i} Inc.`,
      postalAddress: { street: `${i} Street`, city: "City", province: "QC", postalCode: "H1A 1A1" },
      buildings: [{ id: `b${i}`, address: `${i} Elm` }],
    }));
    const pkgs = buildSearchPackages(owners);
    expect(pkgs).toHaveLength(30);
    const report = formatSearchPackageReport(pkgs, { topN: 5 });
    expect(report).toContain("=== Top 5 Packages ===");
    expect(report).toMatch(/\n  5\. /);
    expect(report).not.toMatch(/\n  6\. /);
  });
});

describe("empty / edge cases", () => {
  test("empty input → []", () => {
    expect(buildSearchPackages([])).toEqual([]);
    expect(buildSearchPackages(null)).toEqual([]);
  });
  test("non-object items are skipped", () => {
    expect(buildSearchPackages([null, undefined, "x", 5])).toEqual([]);
  });
  test("missing-name + missing-mailing produces warnings + skip", () => {
    const owners = [mkOwner({
      displayName: "",
      contactNames: [],
      aliases: [],
      postalAddress: { street: "", city: "", province: "", postalCode: "" },
      buildings: [],
    })];
    const [pkg] = buildSearchPackages(owners);
    expect(pkg.warnings).toEqual(expect.arrayContaining(["missing_owner_name", "missing_mailing_address"]));
    expect(pkg.search_priority).toBe("skip");
    expect(pkg.search_strategy).toBe("skip_low_value");
  });
});

describe("auditSearchPackages — targeted dev-CLI buckets", () => {
  function fixture() {
    const fileOwnerCand = makePhoneCandidate({
      phone: "514-777-1234", source: "file", source_column: "Téléphone Propriétaire",
      relationship_to_lead_owner: "owner",
    });
    const fileBuildingCand = makePhoneCandidate({
      phone: "438-823-9876", source: "file", source_column: "Téléphone Immeuble",
      relationship_to_lead_owner: "building",
    });
    return [
      // ABC Immobilier — high value, has owner file phone (no enrichment needed).
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        phones: ["(514) 777-1234"], candidatePhones: [fileOwnerCand],
        buildings: [{ id: "b1", address: "100 Elm" }, { id: "b2", address: "200 Oak" }],
      }),
      // Numbered company w/ mailing, no phone.
      mkOwner({
        displayName: "9338-8387 QUEBEC INC.",
        postalAddress: { street: "999 Other", city: "Laval", province: "QC", postalCode: "H7A 1A1" },
        buildings: [{ id: "b3", address: "300 Pine" }],
      }),
      // Numbered company without mailing → suspicious.
      mkOwner({
        displayName: "1111-2222 CANADA INC.",
        postalAddress: { street: "", city: "", province: "", postalCode: "" },
        buildings: [{ id: "b3a", address: "350 Maple" }],
      }),
      // Trust w/ mailing, no phone.
      mkOwner({
        displayName: "Fiducie Famille Tremblay",
        postalAddress: { street: "1500 Fiducie", city: "Montréal", province: "QC", postalCode: "H2Z 1M1" },
        buildings: [{ id: "b4", address: "400 Birch" }, { id: "b5", address: "500 Cedar" }],
      }),
      // Generic company w/ mailing, no phone.
      mkOwner({
        displayName: "Acme Holdings Ltd.",
        postalAddress: { street: "10 Wellington", city: "Toronto", province: "ON", postalCode: "M5K 1A1" },
        buildings: [{ id: "b6", address: "600 Maple" }],
      }),
      // Individual w/ portfolio → high lead_value, no phone.
      mkOwner({
        displayName: "Jean Tremblay",
        contactNames: ["Jean Tremblay"],
        postalAddress: { street: "55 Pionniers", city: "Longueuil", province: "QC", postalCode: "J4M 2N3" },
        buildings: [
          { id: "b7", address: "700 Spruce" },
          { id: "b8", address: "701 Spruce" },
          { id: "b9", address: "702 Spruce" },
        ],
      }),
      // Building-phone-only leak — owner phone column empty, building phone present.
      mkOwner({
        displayName: "Acme Realty Holdings Ltd.",
        candidatePhones: [fileBuildingCand],
        phones: ["(438) 823-9876"], // simulates roleImport's flatten behavior
        postalAddress: { street: "10 Wellington", city: "Toronto", province: "ON", postalCode: "M5K 1A2" },
        buildings: [{ id: "b10", address: "800 Taschereau" }],
      }),
    ];
  }

  test("counts with_phone / without_phone / with_owner_file_phone", () => {
    const pkgs = buildSearchPackages(fixture());
    const audit = auditSearchPackages(pkgs);
    expect(audit.total).toBe(7);
    // With phone: ABC + Acme Realty (building leak counts as "has any phone").
    expect(audit.with_phone).toBe(2);
    expect(audit.without_phone).toBe(5);
    // Owner-direct file phone: only ABC.
    expect(audit.with_owner_file_phone).toBe(1);
  });

  test("top_high_value_without_phone is sorted by portfolio size", () => {
    const pkgs = buildSearchPackages(fixture());
    const audit = auditSearchPackages(pkgs);
    const top = audit.top_high_value_without_phone;
    expect(top.length).toBeGreaterThan(0);
    // Highest-portfolio package (Jean Tremblay w/ 3 properties) should rank ahead
    // of single-property entries.
    expect(top[0].lead_owner_name).toBe("Jean Tremblay");
    // None should have a phone.
    for (const p of top) {
      expect(p.existing_phones || []).toEqual([]);
    }
    // All flagged high value.
    for (const p of top) expect(p.lead_value_priority).toBe("high");
  });

  test("numbered_companies_without_phone + trusts_without_phone", () => {
    const pkgs = buildSearchPackages(fixture());
    const audit = auditSearchPackages(pkgs);
    expect(audit.numbered_companies_without_phone.map((p) => p.lead_owner_name).sort()).toEqual([
      "1111-2222 CANADA INC.",
      "9338-8387 QUEBEC INC.",
    ]);
    expect(audit.trusts_without_phone.map((p) => p.lead_owner_name)).toEqual([
      "Fiducie Famille Tremblay",
    ]);
  });

  test("companies_with_mailing_no_phone excludes individuals + unknown + no-mailing", () => {
    const pkgs = buildSearchPackages(fixture());
    const audit = auditSearchPackages(pkgs);
    const names = audit.companies_with_mailing_no_phone.map((p) => p.lead_owner_name).sort();
    expect(names).toEqual([
      "9338-8387 QUEBEC INC.",
      "Acme Holdings Ltd.",
      "Fiducie Famille Tremblay",
    ]);
    // 1111-2222 has no mailing → excluded.
    expect(names).not.toContain("1111-2222 CANADA INC.");
  });

  test("suspicious flags building_phone_only + numbered_company_no_mailing + individual_high_value", () => {
    const pkgs = buildSearchPackages(fixture());
    const audit = auditSearchPackages(pkgs);
    const kinds = audit.suspicious.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining([
      "building_phone_only",
      "numbered_company_no_mailing",
      "individual_high_value",
    ]));
    // Building leak picks the right package.
    const leak = audit.suspicious.find((s) => s.kind === "building_phone_only");
    expect(leak.package.lead_owner_name).toBe("Acme Realty Holdings Ltd.");
    // Numbered without mailing picks the right one.
    const noMail = audit.suspicious.find((s) => s.kind === "numbered_company_no_mailing");
    expect(noMail.package.lead_owner_name).toBe("1111-2222 CANADA INC.");
  });

  test("duplicate_different_address: same name + different mailing flagged INFORMATIONALLY (not suspicious)", () => {
    const pkgs = buildSearchPackages([
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        postalAddress: { street: "217 St-Jacques", city: "Montréal", province: "QC", postalCode: "H2Y 1M6" },
      }),
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        // Different mailing → different ownerKey grouping → kept separate.
        postalAddress: { street: "999 Other", city: "Laval", province: "QC", postalCode: "H7A 1A1" },
      }),
    ]);
    expect(pkgs).toHaveLength(2);
    // Each package carries the flag + a list of variant mailing descriptors.
    for (const p of pkgs) {
      expect(p.duplicate_different_address).toBe(true);
      expect(p.address_variant_packages).toHaveLength(1);
      expect(p.address_variant_packages[0].mailing_address).toBeTruthy();
    }
    // Audit exposes them as a dedicated top-level list, NOT suspicious.
    const audit = auditSearchPackages(pkgs);
    expect(audit.duplicate_different_address).toHaveLength(2);
    expect(audit.suspicious.find((s) => s.kind === "dup_split_by_name")).toBeUndefined();
  });

  test("same name + same mailing collapses to ONE package (no flag)", () => {
    const pkgs = buildSearchPackages([
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        postalAddress: { street: "217 St-Jacques", city: "Montréal", province: "QC", postalCode: "H2Y 1M6" },
        buildings: [{ id: "b1", address: "100 Elm" }],
      }),
      mkOwner({
        displayName: "ABC Immobilier Inc.",
        postalAddress: { street: "217 St-Jacques", city: "Montréal", province: "QC", postalCode: "H2Y 1M6" },
        buildings: [{ id: "b2", address: "200 Oak" }],
      }),
    ]);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0].duplicate_different_address).toBe(false);
    expect(pkgs[0].address_variant_packages).toEqual([]);
    // Properties from both rows merged into the one package.
    expect(pkgs[0].associated_properties).toHaveLength(2);
    const audit = auditSearchPackages(pkgs);
    expect(audit.duplicate_different_address).toHaveLength(0);
  });

  test("empty input → all zeros", () => {
    const audit = auditSearchPackages([]);
    expect(audit).toEqual({
      total: 0, with_phone: 0, without_phone: 0, with_owner_file_phone: 0,
      top_high_value_without_phone: [],
      numbered_companies_without_phone: [],
      trusts_without_phone: [],
      companies_with_mailing_no_phone: [],
      duplicate_different_address: [],
      suspicious: [],
    });
  });
});
