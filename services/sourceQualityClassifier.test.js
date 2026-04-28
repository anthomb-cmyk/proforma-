// services/sourceQualityClassifier.test.js
//
// Run with: node --test services/sourceQualityClassifier.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySource,
  isAllowedSource,
  isRejectedSource,
} from "./sourceQualityClassifier.js";

test("classifies B2BHint as company_profile", () => {
  const out = classifySource({
    url: "https://b2bhint.com/en/company/qc/9338-8387-quebec-inc",
    title: "Gestion X Inc. - B2BHint",
    snippet: "Dirigeants: Jean Dupont, Marie Martin",
  });
  assert.equal(out.quality, "company_profile");
  assert.ok(out.reasons.includes("company_profile_domain"));
});

test("classifies registre des entreprises as company_profile, not government", () => {
  // Registre is on .gouv.qc.ca but is a corporate registry, not a municipal page.
  const out = classifySource({
    url: "https://www.registreentreprises.gouv.qc.ca/RQAnonymeGR/GR/GR03/GR03A2_19A_PIU_RechEnt_PC.aspx?NEQ=9338838387",
    title: "Registre des entreprises du Québec - Gestion X Inc.",
    snippet: "Adresse: 123 rue Principale, Montréal",
  });
  assert.equal(out.quality, "company_profile");
});

test("classifies opencorporates as company_profile", () => {
  const out = classifySource({
    url: "https://opencorporates.com/companies/ca_qc/9338838387",
    title: "GESTION X INC · OpenCorporates",
    snippet: "Quebec corporation NEQ 9338838387",
  });
  assert.equal(out.quality, "company_profile");
});

test("classifies municipal pages as government", () => {
  const out = classifySource({
    url: "https://www.ville.montreal.qc.ca/portal/page",
    title: "Ville de Montréal — Services aux citoyens",
    snippet: "...",
  });
  assert.equal(out.quality, "government");
});

test("classifies couriers (UPS Store) as junk", () => {
  const out = classifySource({
    url: "https://locations.theupsstore.com/qc/montreal/123-rue-principale",
    title: "The UPS Store — Montréal",
    snippet: "Mailbox services and shipping",
  });
  assert.equal(out.quality, "junk");
});

test("classifies social networks as junk", () => {
  const out = classifySource({
    url: "https://www.facebook.com/some-business",
    title: "Some Business",
    snippet: "...",
  });
  assert.equal(out.quality, "junk");
});

test("classifies pages jaunes as directory", () => {
  const out = classifySource({
    url: "https://www.pagesjaunes.ca/bus/Quebec/Montreal/Gestion-X/123.html",
    title: "Gestion X - Pages Jaunes",
    snippet: "...",
  });
  assert.equal(out.quality, "directory");
});

test("classifies real-estate keyword in title as real_estate", () => {
  const out = classifySource({
    url: "https://immodupont.ca",
    title: "Immobilière Dupont — Gestion immobilière à Montréal",
    snippet: "Property management services",
  });
  assert.equal(out.quality, "real_estate");
});

test("classifies plain business website as private_business", () => {
  const out = classifySource({
    url: "https://example-business.com",
    title: "Example Business Inc.",
    snippet: "Quality services since 1990",
  });
  assert.equal(out.quality, "private_business");
});

test("isAllowedSource accepts business/RE/profile/directory", () => {
  assert.equal(isAllowedSource("private_business"), true);
  assert.equal(isAllowedSource("real_estate"), true);
  assert.equal(isAllowedSource("company_profile"), true);
  assert.equal(isAllowedSource("directory"), true);
  assert.equal(isAllowedSource("government"), false);
  assert.equal(isAllowedSource("junk"), false);
});

test("isRejectedSource rejects government + junk only", () => {
  assert.equal(isRejectedSource("government"), true);
  assert.equal(isRejectedSource("junk"), true);
  assert.equal(isRejectedSource("private_business"), false);
  assert.equal(isRejectedSource("real_estate"), false);
  assert.equal(isRejectedSource("company_profile"), false);
  assert.equal(isRejectedSource("directory"), false);
});

test("handles empty / null input safely", () => {
  assert.equal(classifySource({}).quality, "private_business");
  assert.equal(classifySource().quality, "private_business");
  assert.equal(classifySource({ url: "", title: "", snippet: "" }).quality, "private_business");
});
