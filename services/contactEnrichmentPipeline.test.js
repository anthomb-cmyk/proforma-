// services/contactEnrichmentPipeline.test.js
//
// Mocked tests for the contact-enrichment pipeline.
// All network calls are stubbed — no external API is hit.
//
// Run with:  node --test services/contactEnrichmentPipeline.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { runContactEnrichmentPreview } from "./contactEnrichmentPipeline.js";

/* ------------------------------------------------------------------ *
 *  Test fixtures
 * ------------------------------------------------------------------ */

function makePkg(overrides = {}) {
  return {
    lead_owner_name: "Immobilier Fictif Inc.",
    legal_entity_category: "inc_ltee",
    mailing_address: "123 rue Fictive",
    mailing_city: "Montréal",
    mailing_province: "QC",
    mailing_postal_code: "H1A 1A1",
    lead_value_priority: "high",
    search_need_priority: "high",
    search_strategy: "direct_entity_then_mailing_address_related_companies",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
    candidatePhones: [],
    existing_phones: [],
    associated_properties: [{ units: 4 }],
    ...overrides,
  };
}

// NANP test numbers (555-01XX range) used throughout.
const PHONE_555 = "(514) 555-0110";
const PHONE_555B = "(514) 555-0122";
const DIGITS_555 = "5145550110";
const DIGITS_555B = "5145550122";

function okSearch(results) {
  return async (_q) => ({ ok: true, results });
}

function failSearch(error = "SEARCH_ERROR") {
  return async (_q) => ({ ok: false, error });
}

/* ------------------------------------------------------------------ *
 *  1. Empty / missing packages returns empty array
 * ------------------------------------------------------------------ */

test("empty packages returns []", async () => {
  const results = await runContactEnrichmentPreview({
    packages: [],
    searchFn: okSearch([]),
  });
  assert.deepEqual(results, []);
});

/* ------------------------------------------------------------------ *
 *  2. Package with owner-direct phone is skipped
 * ------------------------------------------------------------------ */

test("package with owner-direct candidatePhone is skipped", async () => {
  const pkg = makePkg({
    candidatePhones: [{
      phone: PHONE_555,
      relationship_to_lead_owner: "owner",
    }],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([]),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "skipped_existing_phone");
  assert.equal(results[0].bestPhone, null);
});

/* ------------------------------------------------------------------ *
 *  3. Phone extracted from search snippet → ready_to_call
 * ------------------------------------------------------------------ */

test("phone in direct-entity search snippet produces ready_to_call", async () => {
  const snippet = `Contactez-nous au ${PHONE_555} pour plus d'informations.`;
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: okSearch([{ title: "Immobilier Fictif Inc.", snippet, url: "https://example.com" }]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.ok(r.phoneCandidates.length > 0, "should have at least one phone candidate");
  assert.ok(r.phoneCandidates.some((c) => c.digits === DIGITS_555), `digits ${DIGITS_555} expected`);
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.bestPhone, PHONE_555);
});

/* ------------------------------------------------------------------ *
 *  4. Email extracted when no phone found → ready_to_email
 * ------------------------------------------------------------------ */

test("email in snippet with no phone produces ready_to_email", async () => {
  const snippet = "Contact: info@fictif-immobilier.qc.ca pour renseignements.";
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: okSearch([{ title: "Fictif Inc.", snippet, url: "https://fictif-immobilier.qc.ca" }]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.ok(r.emailCandidates.length > 0, "should have email candidate");
  assert.equal(r.emailCandidates[0].email, "info@fictif-immobilier.qc.ca");
  assert.equal(r.status, "ready_to_email");
  assert.equal(r.bestEmail, "info@fictif-immobilier.qc.ca");
});

/* ------------------------------------------------------------------ *
 *  5. No contact found → no_contact_found
 * ------------------------------------------------------------------ */

test("no phone or email in results produces no_contact_found", async () => {
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: okSearch([{ title: "Some page", snippet: "Nothing useful here.", url: "https://example.org" }]),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "no_contact_found");
  assert.equal(results[0].bestPhone, null);
  assert.equal(results[0].bestEmail, null);
});

/* ------------------------------------------------------------------ *
 *  6. Limit caps how many packages are processed
 * ------------------------------------------------------------------ */

test("limit=2 processes only the first 2 packages", async () => {
  const pkgs = [makePkg(), makePkg(), makePkg(), makePkg()];
  const results = await runContactEnrichmentPreview({
    packages: pkgs,
    limit: 2,
    searchFn: okSearch([]),
  });
  assert.equal(results.length, 2);
});

/* ------------------------------------------------------------------ *
 *  7. Max limit is capped at 10
 * ------------------------------------------------------------------ */

test("limit above 10 is capped at 10", async () => {
  const pkgs = Array.from({ length: 15 }, () => makePkg());
  const results = await runContactEnrichmentPreview({
    packages: pkgs,
    limit: 15,
    searchFn: okSearch([]),
  });
  assert.equal(results.length, 10);
});

/* ------------------------------------------------------------------ *
 *  8. Search failure is tolerated — package returns no_contact_found
 * ------------------------------------------------------------------ */

test("search failure is tolerated and produces no_contact_found", async () => {
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: failSearch("BRAVE_HTTP_429"),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "no_contact_found");
  assert.ok(
    results[0].evidence.some((e) => e.includes("direct_search_failed")),
    "evidence should record the failure",
  );
});

/* ------------------------------------------------------------------ *
 *  9. Phone extracted from fetched page body
 * ------------------------------------------------------------------ */

test("phone extracted from fetched page body is recorded", async () => {
  const pageHtml = `<html><body><p>Ring us: ${PHONE_555B}</p></body></html>`;
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    // Return a URL in the search results so the pipeline fetches it.
    searchFn: okSearch([{
      title: "Fictif Inc.",
      snippet: "Visit our website for details.",
      url: "https://fictif.example.com",
    }]),
    fetchPageFn: async (_url) => pageHtml,
  });
  assert.equal(results.length, 1);
  const r = results[0];
  const pageCand = r.phoneCandidates.find((c) => c.source === "page");
  assert.ok(pageCand, "should have a page-sourced phone candidate");
  assert.equal(pageCand.digits, DIGITS_555B);
});

/* ------------------------------------------------------------------ *
 *  10. Numbered-company packages are not given direct-entity queries
 * ------------------------------------------------------------------ */

test("numbered_company package uses mailing_address_only strategy", async () => {
  const queriesUsed = [];
  const searchSpy = async (q) => {
    queriesUsed.push(q);
    return { ok: true, results: [] };
  };

  const pkg = makePkg({
    lead_owner_name: "9123456 QUÉBEC INC.",
    legal_entity_category: "numbered_company",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });

  await runContactEnrichmentPreview({ packages: [pkg], searchFn: searchSpy });

  // All queries issued should come from the mailing-discovery list, never
  // from a direct-entity query for the numbered company name.
  for (const q of queriesUsed) {
    assert.ok(
      !q.includes("9123456 QUÉBEC INC."),
      `direct query for numbered company name should not be issued; got: "${q}"`,
    );
  }
});
