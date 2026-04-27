import {
  normalizeEmailKey,
  extractEmailsFromText,
  mergeEmailLists,
  normalizeWebsiteKey,
  extractWebsitesFromText,
  mergeWebsiteLists,
  classifyContactColumn,
  makePhoneCandidate,
  makeEmailCandidate,
  makeWebsiteCandidate,
  extractContactCandidatesFromRow,
  mergePhoneCandidates,
  mergeEmailCandidates,
  mergeWebsiteCandidates,
  flattenPhoneCandidates,
  flattenEmailCandidates,
  flattenWebsiteCandidates,
  pickBestPhone,
  pickBestEmail,
  pickBestWebsite,
  candidatesFromOnlinePhones,
  candidatesFromOnlineEmails,
  candidatesFromOnlineWebsites,
} from "./contactCandidates.js";

describe("normalizeEmailKey", () => {
  test("lowercases and trims", () => {
    expect(normalizeEmailKey("  Jean@Example.COM  ")).toBe("jean@example.com");
  });
  test("strips surrounding punctuation", () => {
    expect(normalizeEmailKey("<jean@example.com>")).toBe("jean@example.com");
    expect(normalizeEmailKey('"jean@example.com",')).toBe("jean@example.com");
  });
  test("rejects malformed inputs", () => {
    expect(normalizeEmailKey("not-an-email")).toBe("");
    expect(normalizeEmailKey("@example.com")).toBe("");
    expect(normalizeEmailKey("jean@")).toBe("");
    expect(normalizeEmailKey("")).toBe("");
    expect(normalizeEmailKey(null)).toBe("");
  });
  test("accepts plus-tagged + dotted local parts", () => {
    expect(normalizeEmailKey("jean.tremblay+work@example.qc.ca")).toBe("jean.tremblay+work@example.qc.ca");
  });
});

describe("extractEmailsFromText", () => {
  test("finds standalone emails in free text", () => {
    const out = extractEmailsFromText("Contactez Jean à jean@example.com ou marie@test.qc.ca");
    expect(out).toEqual(["jean@example.com", "marie@test.qc.ca"]);
  });
  test("dedupes case-insensitively", () => {
    const out = extractEmailsFromText("jean@Example.com et JEAN@example.com");
    expect(out).toEqual(["jean@example.com"]);
  });
  test("returns [] for empty / no matches", () => {
    expect(extractEmailsFromText("")).toEqual([]);
    expect(extractEmailsFromText("aucune adresse")).toEqual([]);
    expect(extractEmailsFromText(null)).toEqual([]);
  });
});

describe("mergeEmailLists", () => {
  test("merges arrays + scalars + nested arrays", () => {
    expect(mergeEmailLists(
      ["jean@x.com", "marie@y.com"],
      "JEAN@x.com",
      [["pierre@z.com"]],
    )).toEqual(["jean@x.com", "marie@y.com", "pierre@z.com"]);
  });
});

describe("normalizeWebsiteKey", () => {
  test("strips protocol + www + trailing slashes", () => {
    expect(normalizeWebsiteKey("https://www.Example.com/")).toBe("example.com");
    expect(normalizeWebsiteKey("http://example.qc.ca")).toBe("example.qc.ca");
  });
  test("preserves path", () => {
    expect(normalizeWebsiteKey("https://example.com/contact/us")).toBe("example.com/contact/us");
  });
  test("rejects emails and file extensions", () => {
    expect(normalizeWebsiteKey("info@example.com")).toBe("");
    expect(normalizeWebsiteKey("logo.png")).toBe("");
    expect(normalizeWebsiteKey("brochure.pdf")).toBe("");
  });
  test("rejects garbage", () => {
    expect(normalizeWebsiteKey("not a url")).toBe("");
    expect(normalizeWebsiteKey("")).toBe("");
  });
});

describe("extractWebsitesFromText", () => {
  test("finds standalone urls", () => {
    const out = extractWebsitesFromText("Visit https://example.com or example.qc.ca for info");
    expect(out).toEqual(expect.arrayContaining(["example.com", "example.qc.ca"]));
  });
  test("ignores email domains", () => {
    const out = extractWebsitesFromText("Email: info@example.com — site: site.qc.ca");
    expect(out).toEqual(["site.qc.ca"]);
  });
});

describe("classifyContactColumn", () => {
  test("identifies phone columns", () => {
    expect(classifyContactColumn("Téléphone").kind).toBe("phone");
    expect(classifyContactColumn("Phone").kind).toBe("phone");
    expect(classifyContactColumn("Mobile cellulaire").kind).toBe("phone");
  });
  test("identifies owner phones", () => {
    expect(classifyContactColumn("Téléphone Propriétaire").relationship).toBe("owner");
  });
  test("identifies building phones", () => {
    expect(classifyContactColumn("Téléphone Immeuble").relationship).toBe("building");
  });
  test("identifies email columns", () => {
    expect(classifyContactColumn("Courriel").kind).toBe("email");
    expect(classifyContactColumn("Owner Email").relationship).toBe("owner");
  });
  test("identifies website columns", () => {
    expect(classifyContactColumn("Site web").kind).toBe("website");
    expect(classifyContactColumn("URL").kind).toBe("website");
  });
  test("identifies notes", () => {
    expect(classifyContactColumn("Notes").kind).toBe("notes");
    expect(classifyContactColumn("Notes").relationship).toBe("notes");
    expect(classifyContactColumn("Remarques").kind).toBe("notes");
  });
  test("address-y columns return empty kind", () => {
    expect(classifyContactColumn("Adresse postale").kind).toBe("");
    expect(classifyContactColumn("Code Postal").kind).toBe("");
    expect(classifyContactColumn("Ville").kind).toBe("");
  });
});

describe("makePhoneCandidate / makeEmailCandidate / makeWebsiteCandidate", () => {
  test("phone candidate carries source + relationship + default confidence", () => {
    const c = makePhoneCandidate({
      phone: "514-555-0142",
      source: "file",
      source_column: "Téléphone Propriétaire 2",
      phone_owner_name: "Jean Tremblay",
      relationship_to_lead_owner: "owner",
      evidence: "imported from longueuil.xlsx",
    });
    expect(c).toEqual({
      phone: "(514) 555-0142",
      source: "file",
      source_column: "Téléphone Propriétaire 2",
      phone_owner_name: "Jean Tremblay",
      relationship_to_lead_owner: "owner",
      confidence: 85,
      evidence: "imported from longueuil.xlsx",
      status: "unverified",
    });
  });
  test("rejects invalid phones", () => {
    expect(makePhoneCandidate({ phone: "abc", source: "file" })).toBeNull();
    expect(makePhoneCandidate({ phone: "", source: "file" })).toBeNull();
  });
  test("email candidate normalizes the address", () => {
    const c = makeEmailCandidate({
      email: "JEAN@Example.com",
      source: "file",
      source_column: "Courriel",
    });
    expect(c.email).toBe("jean@example.com");
  });
  test("website candidate normalizes scheme/www", () => {
    const c = makeWebsiteCandidate({
      website: "https://www.Example.com/contact",
      source: "google_places",
    });
    expect(c.website).toBe("example.com/contact");
    expect(c.source).toBe("google_places");
    expect(c.confidence).toBe(70);
  });
  test("unknown source falls back to 'file'", () => {
    const c = makePhoneCandidate({ phone: "5145550142", source: "bogus" });
    expect(c.source).toBe("file");
  });
});

describe("extractContactCandidatesFromRow", () => {
  test("extracts owner phone, building phone, owner email", () => {
    const row = {
      "Propriétaire": "Jean Tremblay",
      "Téléphone Propriétaire": "514-555-0142",
      "Téléphone Immeuble": "438-555-0143",
      "Courriel Propriétaire": "jean@example.com",
      "Adresse postale": "123 rue Saint-Jacques, Montréal",
    };
    const out = extractContactCandidatesFromRow(row, { ownerName: "Jean Tremblay" });
    expect(out.candidatePhones).toHaveLength(2);
    const owner = out.candidatePhones.find((c) => c.relationship_to_lead_owner === "owner");
    const bldg = out.candidatePhones.find((c) => c.relationship_to_lead_owner === "building");
    expect(owner.phone).toBe("(514) 555-0142");
    expect(owner.source_column).toBe("Téléphone Propriétaire");
    expect(owner.source).toBe("file");
    expect(owner.phone_owner_name).toBe("Jean Tremblay");
    expect(bldg.phone).toBe("(438) 555-0143");
    expect(bldg.relationship_to_lead_owner).toBe("building");
    expect(out.candidateEmails).toHaveLength(1);
    expect(out.candidateEmails[0].email).toBe("jean@example.com");
    expect(out.candidateEmails[0].relationship_to_lead_owner).toBe("owner");
  });

  test("scans notes for phones, emails, websites", () => {
    const row = {
      "Notes": "Appeler au 514-555-0142, courriel jean@example.com, site example.qc.ca",
    };
    const out = extractContactCandidatesFromRow(row);
    expect(out.candidatePhones).toHaveLength(1);
    expect(out.candidatePhones[0].relationship_to_lead_owner).toBe("notes");
    expect(out.candidatePhones[0].source_column).toBe("Notes");
    expect(out.candidateEmails).toHaveLength(1);
    expect(out.candidateWebsites).toHaveLength(1);
    expect(out.candidateWebsites[0].website).toBe("example.qc.ca");
  });

  test("multiple phones in a single cell are all extracted", () => {
    const row = { "Téléphone": "514-555-0142 / 438-555-0143" };
    const out = extractContactCandidatesFromRow(row);
    expect(out.candidatePhones).toHaveLength(2);
    expect(out.candidatePhones[0].source_column).toBe("Téléphone");
    expect(out.candidatePhones[1].source_column).toBe("Téléphone");
  });

  test("address columns are skipped (no false-positive phones from civic numbers)", () => {
    const row = { "Adresse postale": "1234 rue Yargeau, Montréal" };
    const out = extractContactCandidatesFromRow(row);
    expect(out.candidatePhones).toEqual([]);
  });

  test("dedupes (phone, source, source_column) within a single row", () => {
    const row = {
      "Téléphone": "514-555-0142",
      "Notes": "Tél. 514-555-0142 et 438-555-0143",
    };
    const out = extractContactCandidatesFromRow(row);
    // Three entries: one from Téléphone, two from Notes (different columns
    // are different source_column even for the same number).
    expect(out.candidatePhones).toHaveLength(3);
    const fromTel = out.candidatePhones.filter((c) => c.source_column === "Téléphone");
    const fromNotes = out.candidatePhones.filter((c) => c.source_column === "Notes");
    expect(fromTel).toHaveLength(1);
    expect(fromNotes).toHaveLength(2);
  });

  test("returns empty for non-object input", () => {
    expect(extractContactCandidatesFromRow(null)).toEqual({
      candidatePhones: [], candidateEmails: [], candidateWebsites: [],
    });
  });
});

describe("merge*Candidates", () => {
  test("mergePhoneCandidates dedupes by (phone, source, source_column)", () => {
    const a = [makePhoneCandidate({ phone: "514-555-0142", source: "file", source_column: "Téléphone" })];
    const b = [makePhoneCandidate({ phone: "514-555-0142", source: "file", source_column: "Téléphone" })];
    const c = [makePhoneCandidate({ phone: "514-555-0142", source: "google_places", evidence: "Place X" })];
    const merged = mergePhoneCandidates(a, b, c);
    expect(merged).toHaveLength(2);
    expect(merged[0].source).toBe("file");
    expect(merged[1].source).toBe("google_places");
  });

  test("first-list wins on collisions", () => {
    const high = [makePhoneCandidate({ phone: "514-555-0142", source: "file", source_column: "X", confidence: 99 })];
    const low  = [makePhoneCandidate({ phone: "514-555-0142", source: "file", source_column: "X", confidence: 10 })];
    const merged = mergePhoneCandidates(high, low);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(99);
  });

  test("mergeEmailCandidates and mergeWebsiteCandidates work the same way", () => {
    const e = mergeEmailCandidates(
      [makeEmailCandidate({ email: "jean@x.com", source: "file" })],
      [makeEmailCandidate({ email: "JEAN@x.com", source: "file" })],
      [makeEmailCandidate({ email: "jean@x.com", source: "web_search" })],
    );
    expect(e).toHaveLength(2);
    const w = mergeWebsiteCandidates(
      [makeWebsiteCandidate({ website: "example.com", source: "file" })],
      [makeWebsiteCandidate({ website: "https://example.com/", source: "file" })],
      [makeWebsiteCandidate({ website: "example.com", source: "google_places" })],
    );
    expect(w).toHaveLength(2);
  });
});

describe("flatten*Candidates", () => {
  test("phones: dedups by normalized key", () => {
    const list = [
      makePhoneCandidate({ phone: "(514) 555-0142", source: "file", confidence: 80 }),
      makePhoneCandidate({ phone: "5145550142", source: "google_places", confidence: 90 }),
      makePhoneCandidate({ phone: "438-555-0143", source: "file", confidence: 80 }),
    ];
    const flat = flattenPhoneCandidates(list);
    expect(flat).toHaveLength(2);
    // formatPhone normalizes both inputs to "(514) 555-0142" — the highest-
    // confidence (google_places) candidate is the one held in the dedup map.
    expect(flat[0]).toBe("(514) 555-0142");
  });
  test("emails / websites: dedup by key", () => {
    expect(flattenEmailCandidates([
      makeEmailCandidate({ email: "jean@x.com", source: "file" }),
      makeEmailCandidate({ email: "JEAN@x.com", source: "web_search" }),
    ])).toEqual(["jean@x.com"]);
    expect(flattenWebsiteCandidates([
      makeWebsiteCandidate({ website: "https://example.com", source: "file" }),
      makeWebsiteCandidate({ website: "example.com", source: "google_places" }),
    ])).toEqual(["example.com"]);
  });
});

describe("pickBest*", () => {
  test("file candidates beat online ones even at lower confidence", () => {
    const list = [
      makePhoneCandidate({ phone: "514-555-0142", source: "file", confidence: 50 }),
      makePhoneCandidate({ phone: "438-555-0143", source: "google_places", confidence: 99 }),
    ];
    expect(pickBestPhone(list)).toBe("(514) 555-0142");
  });
  test("falls back to online when no file candidate exists", () => {
    const list = [
      makePhoneCandidate({ phone: "438-555-0143", source: "google_places", confidence: 80 }),
      makePhoneCandidate({ phone: "514-555-0142", source: "directory", confidence: 65 }),
    ];
    expect(pickBestPhone(list)).toBe("(438) 555-0143");
  });
  test("emails / websites use the same priority", () => {
    expect(pickBestEmail([
      makeEmailCandidate({ email: "online@x.com", source: "google_places", confidence: 99 }),
      makeEmailCandidate({ email: "file@x.com", source: "file", confidence: 50 }),
    ])).toBe("file@x.com");
    expect(pickBestWebsite([
      makeWebsiteCandidate({ website: "online.com", source: "google_places", confidence: 99 }),
      makeWebsiteCandidate({ website: "file.com", source: "file", confidence: 50 }),
    ])).toBe("file.com");
  });
  test("returns '' on empty input", () => {
    expect(pickBestPhone([])).toBe("");
    expect(pickBestEmail(null)).toBe("");
  });
});

describe("candidatesFrom* online helpers", () => {
  test("phones tag source as google_places by default", () => {
    const c = candidatesFromOnlinePhones(["514-555-0142", "438-555-0143"], { evidence: "matched X" });
    expect(c).toHaveLength(2);
    expect(c[0].source).toBe("google_places");
    expect(c[0].evidence).toBe("matched X");
    expect(c[0].relationship_to_lead_owner).toBe("owner");
  });
  test("emails default to web_search source", () => {
    const c = candidatesFromOnlineEmails(["jean@x.com"]);
    expect(c[0].source).toBe("web_search");
  });
  test("websites default to google_places source", () => {
    const c = candidatesFromOnlineWebsites(["https://example.com"]);
    expect(c[0].website).toBe("example.com");
    expect(c[0].source).toBe("google_places");
  });
});

describe("non-overwrite invariant: file candidates survive online merge", () => {
  test("file phones + online phones produce a list with both, file first", () => {
    const fileC = [makePhoneCandidate({ phone: "514-555-0142", source: "file", source_column: "Téléphone" })];
    const onlineC = candidatesFromOnlinePhones(["514-555-0142", "438-555-0143"], { evidence: "Places" });
    const merged = mergePhoneCandidates(fileC, onlineC);
    // Same phone from file + google_places = TWO entries (different sources).
    expect(merged).toHaveLength(3);
    const sources = merged.map((c) => c.source);
    expect(sources[0]).toBe("file");
    expect(sources).toContain("google_places");
    // The flattened list shows just two unique phones.
    expect(flattenPhoneCandidates(merged)).toHaveLength(2);
  });
});
