import { buildExportRowFromResult, buildExportSummary } from "./searchPackageExportShape.js";
import { buildLeadIdentityKey } from "./dealHelpers.js";

describe("buildExportRowFromResult", () => {
  test("maps bestPhone → phone + bestPhone fields", () => {
    const row = buildExportRowFromResult({
      lead_owner_name: "GESTION X INC",
      mailing_address: "100 rue Y, Montréal QC",
      bestPhone: "(514) 555-0100",
      bestEmail: "x@y.ca",
      bestWebsite: "https://y.ca",
      status: "ready_to_call",
      evidence: ["a", "b", "c"],
    });
    expect(row.companyName).toBe("GESTION X INC");
    expect(row.lead_owner_name).toBe("GESTION X INC");
    expect(row.leadContact).toBe("GESTION X INC");
    expect(row.buildingAddress).toBe("100 rue Y, Montréal QC");
    expect(row.inputAddress).toBe("100 rue Y, Montréal QC");
    expect(row.matchedAddress).toBe("100 rue Y, Montréal QC");
    expect(row.phone).toBe("(514) 555-0100");
    expect(row.bestPhone).toBe("(514) 555-0100");
    expect(row.bestEmail).toBe("x@y.ca");
    expect(row.evidence).toBe("a | b | c");
  });

  test("two results with same owner but different addresses produce different identity keys", () => {
    const a = buildExportRowFromResult({
      lead_owner_name: "GESTION X INC", mailing_address: "100 rue Y", bestPhone: "5145550100",
    });
    const b = buildExportRowFromResult({
      lead_owner_name: "GESTION X INC", mailing_address: "200 rue Z", bestPhone: "5145550101",
    });
    expect(a.buildingAddress).not.toBe(b.buildingAddress);
    expect(a.companyName).toBe(b.companyName);
  });

  test("preserves r.address when present (overrides mailing_address)", () => {
    const row = buildExportRowFromResult({
      lead_owner_name: "X",
      address: "OFFICIAL ADDRESS",
      mailing_address: "OTHER ADDRESS",
    });
    expect(row.buildingAddress).toBe("OFFICIAL ADDRESS");
  });

  test("falls back to empty strings when fields missing", () => {
    const row = buildExportRowFromResult({});
    expect(row.companyName).toBe("");
    expect(row.buildingAddress).toBe("");
    expect(row.phone).toBe("");
  });

  test("includes status defaulting to ready_to_call", () => {
    expect(buildExportRowFromResult({}).status).toBe("ready_to_call");
    expect(buildExportRowFromResult({ status: "needs_review" }).status).toBe("needs_review");
  });

  test("includes both aliased phone/email/website field pairs", () => {
    const row = buildExportRowFromResult({
      bestPhone: "5141234567",
      bestEmail: "a@b.com",
      bestWebsite: "https://b.com",
    });
    expect(row.phone).toBe(row.bestPhone);
    expect(row.email).toBe(row.bestEmail);
    expect(row.website).toBe(row.bestWebsite);
  });

  test("candidatePhones calls enrichResultToCandidatePhone helper when provided", () => {
    const fakeHelper = jest.fn().mockReturnValue({ phone: "5141234567", source: "enrichment_web_search" });
    const row = buildExportRowFromResult(
      { bestPhone: "5141234567" },
      { enrichResultToCandidatePhone: fakeHelper }
    );
    expect(fakeHelper).toHaveBeenCalled();
    expect(row.candidatePhones).toHaveLength(1);
  });

  test("candidatePhones is empty when bestPhone is absent", () => {
    const row = buildExportRowFromResult({ bestEmail: "a@b.com" });
    expect(row.candidatePhones).toHaveLength(0);
  });

  test("evidence slices to last 4 items and joins with pipe", () => {
    const row = buildExportRowFromResult({
      evidence: ["e1", "e2", "e3", "e4", "e5"],
    });
    expect(row.evidence).toBe("e2 | e3 | e4 | e5");
  });

  test("evidence is empty string when not an array", () => {
    expect(buildExportRowFromResult({ evidence: null }).evidence).toBe("");
    expect(buildExportRowFromResult({}).evidence).toBe("");
  });
});

describe("buildExportSummary", () => {
  test("export summary reflects real importer counts, not sent count", () => {
    const summary = buildExportSummary(
      { added: 0, updated: 0, skipped: 3 },
      3,
      { skippedReview: 5, skippedNoContact: 2, skippedAlreadyExported: 0 }
    );
    expect(summary.added).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.skippedByImporter).toBe(3);
    expect(summary.totalSent).toBe(3);
    expect(summary.skippedReview).toBe(5);
    expect(summary.skippedNoContact).toBe(2);
    expect(summary.skippedAlreadyExported).toBe(0);
  });

  test("export summary handles missing importer counts gracefully", () => {
    const summary = buildExportSummary(undefined, 5, { skippedReview: 0, skippedNoContact: 0, skippedAlreadyExported: 0 });
    expect(summary.added).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.skippedByImporter).toBe(0);
    expect(summary.totalSent).toBe(5);
  });

  test("export summary handles partial result gracefully", () => {
    const summary = buildExportSummary({ added: 2 }, 5, {});
    expect(summary.added).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.skippedByImporter).toBe(0);
  });
});

describe("integration: identity key uniqueness", () => {
  test("two exports for same owner at different addresses get unique identity keys", () => {
    const r1 = buildExportRowFromResult({ lead_owner_name: "GESTION X INC", mailing_address: "100 rue A" });
    const r2 = buildExportRowFromResult({ lead_owner_name: "GESTION X INC", mailing_address: "200 rue B" });
    const k1 = buildLeadIdentityKey({ companyName: r1.companyName, buildingAddress: r1.buildingAddress, contactName: "" });
    const k2 = buildLeadIdentityKey({ companyName: r2.companyName, buildingAddress: r2.buildingAddress, contactName: "" });
    expect(k1).not.toBe(k2);
  });

  test("same owner at same address produces the same key (dedup is intentional)", () => {
    const r1 = buildExportRowFromResult({ lead_owner_name: "GESTION X INC", mailing_address: "100 rue A" });
    const r2 = buildExportRowFromResult({ lead_owner_name: "GESTION X INC", mailing_address: "100 rue A" });
    const k1 = buildLeadIdentityKey({ companyName: r1.companyName, buildingAddress: r1.buildingAddress, contactName: "" });
    const k2 = buildLeadIdentityKey({ companyName: r2.companyName, buildingAddress: r2.buildingAddress, contactName: "" });
    expect(k1).toBe(k2);
  });
});
