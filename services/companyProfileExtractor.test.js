// services/companyProfileExtractor.test.js
//
// Run with: node --test services/companyProfileExtractor.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  isCompanyProfileUrl,
  extractCompanyProfile,
  buildProfileExpansionQueries,
} from "./companyProfileExtractor.js";

test("isCompanyProfileUrl matches known registry domains", () => {
  assert.equal(isCompanyProfileUrl("https://b2bhint.com/en/company/qc/9338-8387-quebec-inc"), true);
  assert.equal(isCompanyProfileUrl("https://opencorporates.com/companies/ca_qc/9338838387"), true);
  assert.equal(isCompanyProfileUrl("https://www.registreentreprises.gouv.qc.ca/path"), true);
  assert.equal(isCompanyProfileUrl("https://example.com"), false);
  assert.equal(isCompanyProfileUrl(""), false);
  assert.equal(isCompanyProfileUrl(null), false);
});

test("returns null for non-profile URLs", () => {
  assert.equal(extractCompanyProfile({
    url: "https://example.com",
    title: "Example",
    snippet: "Anything",
  }), null);
  assert.equal(extractCompanyProfile(null), null);
  assert.equal(extractCompanyProfile({}), null);
});

test("extracts B2BHint profile: company name + directors + NEQ", () => {
  const out = extractCompanyProfile({
    url: "https://b2bhint.com/en/company/qc/9338-8387-quebec-inc",
    title: "Gestion Tremblay Inc. - B2BHint",
    snippet: "NEQ: 9338-8387-12. Dirigeants: Jean Tremblay, Marie Dupont. Adresse: 123 rue Principale, Montréal.",
  });
  assert.ok(out);
  assert.equal(out.companyName, "Gestion Tremblay Inc.");
  assert.equal(out.enterpriseNumber, "9338838712");
  assert.deepEqual(out.directors, ["Jean Tremblay", "Marie Dupont"]);
  assert.match(out.legalAddress, /123 rue Principale/);
  assert.equal(out.sourceUrl, "https://b2bhint.com/en/company/qc/9338-8387-quebec-inc");
});

test("extracts registre des entreprises profile name", () => {
  const out = extractCompanyProfile({
    url: "https://www.registreentreprises.gouv.qc.ca/RQAnonymeGR/...",
    title: "Registre des entreprises du Québec - Gestion X Inc.",
    snippet: "Adresse: 99 rue Sainte-Catherine, Montréal, QC. Activité: Gestion immobilière",
  });
  assert.ok(out);
  assert.equal(out.companyName, "Gestion X Inc.");
  assert.match(out.legalAddress, /99 rue Sainte-Catherine/);
  assert.match(out.activity, /Gestion immobilière/);
});

test("extracts related companies from snippet", () => {
  const out = extractCompanyProfile({
    url: "https://b2bhint.com/en/company/qc/abc",
    title: "Holding ABC Inc. - B2BHint",
    snippet: "Entreprises liées: Gestion ABC Inc., Immobilier ABC Inc., Investissements ABC.",
  });
  assert.ok(out.relatedCompanies.length >= 2);
  assert.ok(out.relatedCompanies.some((c) => /Gestion ABC/.test(c)));
  assert.ok(out.relatedCompanies.some((c) => /Immobilier ABC/.test(c)));
});

test("missing optional fields default to empty", () => {
  const out = extractCompanyProfile({
    url: "https://b2bhint.com/x",
    title: "Bare Inc. - B2BHint",
    snippet: "",
  });
  assert.equal(out.companyName, "Bare Inc.");
  assert.equal(out.enterpriseNumber, "");
  assert.equal(out.legalAddress, "");
  assert.deepEqual(out.directors, []);
  assert.deepEqual(out.relatedCompanies, []);
});

test("buildProfileExpansionQueries: directors anchored at mailing address", () => {
  const profile = {
    companyName: "Gestion Tremblay Inc.",
    enterpriseNumber: "9338838712",
    directors: ["Jean Tremblay", "Marie Dupont"],
    relatedCompanies: ["Immobilier Tremblay Inc."],
    legalAddress: "",
    activity: "",
    officers: [],
    sourceUrl: "https://b2bhint.com/x",
  };
  const queries = buildProfileExpansionQueries(profile, "123 rue Principale, Montréal, QC");

  assert.ok(queries.some((q) => /"Jean Tremblay".*Montréal/.test(q)));
  assert.ok(queries.some((q) => /"Marie Dupont".*Montréal/.test(q)));
  assert.ok(queries.some((q) => /"Immobilier Tremblay/.test(q)));
  // NEQ → registry lookup
  assert.ok(queries.some((q) => /9338838712/.test(q)));
  // No duplicates
  assert.equal(new Set(queries.map((q) => q.toLowerCase())).size, queries.length);
});

test("buildProfileExpansionQueries: empty profile returns []", () => {
  assert.deepEqual(buildProfileExpansionQueries(null), []);
  assert.deepEqual(buildProfileExpansionQueries({
    directors: [], relatedCompanies: [], enterpriseNumber: "",
  }), []);
});

test("buildProfileExpansionQueries: falls back gracefully without mailing address", () => {
  const profile = {
    directors: ["Jean Test"],
    relatedCompanies: [],
    enterpriseNumber: "",
  };
  const queries = buildProfileExpansionQueries(profile, "");
  assert.equal(queries.length, 1);
  assert.match(queries[0], /Jean Test/);
});
