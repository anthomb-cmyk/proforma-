// services/contactEnrichmentPipeline.test.js
//
// Mocked tests for the contact-enrichment pipeline.
// All network calls are stubbed — no external API is hit.
//
// Run with:  node --test services/contactEnrichmentPipeline.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  runContactEnrichmentPreview,
  isJunkResult,
  hasNameOverlap,
} from "./contactEnrichmentPipeline.js";

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

test("limit above 100 is capped at 100", async () => {
  const pkgs = Array.from({ length: 120 }, () => makePkg());
  const results = await runContactEnrichmentPreview({
    packages: pkgs,
    limit: 120,
    searchFn: okSearch([]),
  });
  assert.equal(results.length, 100);
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

/* ------------------------------------------------------------------ *
 *  11. UPS Store result is rejected — phone never reaches bestPhone
 * ------------------------------------------------------------------ */

test("UPS Store result is rejected and phone is not promoted to bestPhone", async () => {
  const snippet = `Ship your packages. Call us: ${PHONE_555}`;
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: okSearch([
      { title: "The UPS Store", snippet, url: "https://theupsstore.ca/locations/123" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  // Phone may appear as a candidate (if not filtered) but must NOT be bestPhone
  assert.equal(r.bestPhone, null, "UPS Store phone must not be bestPhone");
  // Evidence should record the rejection
  assert.ok(
    r.evidence.some((e) => e.includes("rejected") && e.toLowerCase().includes("ups")),
    "evidence should show UPS Store was rejected",
  );
});

/* ------------------------------------------------------------------ *
 *  12. Municipal/city page is rejected
 * ------------------------------------------------------------------ */

test("municipal city-hall page is rejected and phone not accepted", async () => {
  const snippet = `Joignez la ville au ${PHONE_555B}`;
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: okSearch([
      { title: "Ville de Montréal – Contact", snippet, url: "https://ville.montreal.qc.ca/contact" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.bestPhone, null, "municipal phone must not be bestPhone");
  assert.ok(
    r.evidence.some((e) => e.includes("rejected")),
    "evidence should record the municipal rejection",
  );
});

/* ------------------------------------------------------------------ *
 *  13. Individual owner + unrelated mailing-address business → not ready_to_call
 * ------------------------------------------------------------------ */

test("individual owner mailing-address business phone does not become ready_to_call", async () => {
  const snippet = `Réservations: ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Jean Tremblay",
    legal_entity_category: "individual",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Restaurant XYZ", snippet, url: "https://restaurantxyz.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.notEqual(r.status, "ready_to_call", "individual + unrelated business must not be ready_to_call");
  assert.equal(r.bestPhone, null, "individual + unrelated business phone must not become bestPhone");
  assert.ok(
    r.evidence.some((e) => e.includes("skipped") && e.includes("individual")),
    "evidence should explain the individual-owner skip",
  );
});

/* ------------------------------------------------------------------ *
 *  14. Exact company name match → high confidence → ready_to_call
 * ------------------------------------------------------------------ */

test("exact company name in search result produces high confidence ready_to_call", async () => {
  const snippet = `Gestion Dupont Inc. — appelez-nous au ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Gestion Dupont Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Gestion Dupont Inc.", snippet, url: "https://gestiondupont.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.confidence, "high");
  assert.equal(r.bestPhone, PHONE_555);
});

/* ------------------------------------------------------------------ *
 *  15. Fiducie + related real-estate company at same address → ready_to_call
 *      (same-address is a strong signal; no nameMatch required)
 * ------------------------------------------------------------------ */

test("fiducie with related RE company at same mailing address → ready_to_call", async () => {
  // A real-estate company co-located with the fiducie is found via the mailing query.
  // Under the revised rules, same-address contact always produces ready_to_call;
  // an RE keyword in the entity name classifies it as related_company_same_mailing_address.
  const snippet = `Immobilier Dupont Inc. — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "FIDUCIE DUPONT",
    legal_entity_category: "trust",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Immobilier Dupont Inc.", snippet, url: "https://immodupont.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.phoneRelationship, "related_company_same_mailing_address");
  assert.equal(r.bestPhone, PHONE_555);
});

/* ------------------------------------------------------------------ *
 *  16. Direct entity result without name match → needs_review, not ready_to_call
 * ------------------------------------------------------------------ */

test("direct-entity result without name overlap produces needs_review", async () => {
  // The search returns a result with a phone but the title does not overlap
  // with the owner name — direct track requires nameMatch for ready_to_call.
  // bestPhone is still set (score ≥ 3) but status is needs_review, not ready_to_call.
  const snippet = `Appelez-nous au ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Gestion Tremblay Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Service Unrelated XYZ", snippet, url: "https://unrelated.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  // Score = 3*1*1 = 3 (source=direct_entity, 1 occurrence, no nameBonus)
  // → directBest is found, nameMatch=false → needs_review with phone set for human review
  assert.equal(r.status, "needs_review");
  assert.notEqual(r.status, "ready_to_call");
  assert.equal(r.bestPhone, PHONE_555, "phone is set but flagged for human review");
});

/* ------------------------------------------------------------------ *
 *  17. Mailing-address contact without RE keyword → same_mailing_address_contact
 * ------------------------------------------------------------------ */

test("mailing-address contact without RE keyword → same_mailing_address_contact, medium confidence", async () => {
  // A generic business (not RE-related) appears at the mailing address.
  // Should still be ready_to_call with same_mailing_address_contact relationship.
  const snippet = `Boulangerie Fictive — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "GESTION FICTIVE INC.",
    legal_entity_category: "gestion",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Boulangerie Fictive", snippet, url: "https://boulangeriefictive.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.phoneRelationship, "same_mailing_address_contact");
  assert.equal(r.confidence, "medium");
  assert.equal(r.bestPhone, PHONE_555);
});

/* ------------------------------------------------------------------ *
 *  18. Direct entity name match → direct_entity_match relationship
 * ------------------------------------------------------------------ */

test("direct entity name match produces direct_entity_match relationship", async () => {
  const snippet = `Placement Lafleur Inc. — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Placement Lafleur Inc.",
    legal_entity_category: "inc_ltee",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Placement Lafleur Inc.", snippet, url: "https://lafleur.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.phoneRelationship, "direct_entity_match");
});

/* ====================================================================== *
 *  Co-owner / company-profile / address-discovery test suite (PR feat/
 *  enrichment-coowner-profile). Exercises the new tracks added in
 *  patches 2–6.
 * ====================================================================== */

/* T1. Co-owner exact full-name match upgrades nameMatch → ready_to_call */
test("[coowner] exact co-owner full-name match → ready_to_call via co_owner_match", async () => {
  // Direct search returns a result whose title is the co-owner's name (not the
  // lead owner). Without co-owner validation this would be needs_review (no
  // nameMatch on the lead owner). With the validation pass it upgrades.
  const snippet = `Marie Tremblay — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "9338-8387 Québec Inc.",
    legal_entity_category: "numbered_company",
    search_strategy: "direct_entity_then_mailing_address_related_companies",
    coOwnerNames: ["Marie Tremblay", "Jean Dupont"],
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Marie Tremblay", snippet, url: "https://example.com" },
    ]),
  });
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.phoneRelationship, "co_owner_match");
});

/* T2. Same-last-name only → needs_review max (NOT ready_to_call) */
test("[coowner] same last name only without corroboration → needs_review", async () => {
  // Lead owner name shares NO token with the result title (so direct nameMatch
  // is false). Co-owner shares only the last name → weak match path only.
  const snippet = `Sophie Tremblay Avocate — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "9876-5432 Québec Inc.",
    legal_entity_category: "numbered_company",
    search_strategy: "mailing_address_only",
    coOwnerNames: ["Jean Tremblay"], // co-owner shares only "Tremblay"
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Sophie Tremblay Avocate", snippet, url: "https://avocate-tremblay.ca" },
    ]),
  });
  const r = results[0];
  // The phone exists but only matches the co-owner by last name → must not
  // auto-promote to ready_to_call. Address-discovery would normally promote
  // numbered-company same-mailing-address phones, but the weak co-owner match
  // forces needs_review.
  assert.notEqual(r.status, "ready_to_call");
});

/* T3. Address-discovery cap is 7 queries per package */
test("[address-discovery] caps at 7 queries per package", async () => {
  let queryCount = 0;
  const seenQueries = [];
  const captureSearch = async (q) => {
    queryCount += 1;
    seenQueries.push(q);
    return { ok: true, results: [] };
  };
  const pkg = makePkg({
    lead_owner_name: "Gestion XYZ Inc.",
    legal_entity_category: "gestion",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
    mailingAddresses: [
      { street: "123 rue Fictive", city: "Montréal", province: "QC", postalCode: "H1A 1A1" },
      { street: "456 av. Test", city: "Laval", province: "QC", postalCode: "H7A 1A1" },
    ],
  });
  await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: captureSearch,
  });
  // Strategy is mailing_address_only so only the address-discovery track runs.
  // Cap is 7 across all addresses combined.
  const addrQueries = seenQueries.filter((q) =>
    /b2bhint|québec inc|company|immobilier|entreprise|gestion immobilière|site:b2bhint/i.test(q),
  );
  assert.ok(addrQueries.length <= 7, `expected ≤ 7 address-discovery queries, got ${addrQueries.length}`);
  assert.ok(addrQueries.length >= 1, "expected at least 1 address-discovery query");
});

/* T4. Address discovery generates evidence trail */
test("[address-discovery] surfaces companies + emits evidence", async () => {
  const snippet = `Gestion ABC Inc. — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "9338-8387 Québec Inc.",
    legal_entity_category: "numbered_company",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Gestion ABC Inc.", snippet, url: "https://abc.ca" },
    ]),
  });
  const r = results[0];
  assert.ok(r.evidence.some((e) => /^addr_discovery:/.test(e)),
    "expected at least one addr_discovery evidence line");
  // Companies discovered at the same mailing address must be ready_to_call
  // for numbered companies (private business + non-individual).
  assert.equal(r.status, "ready_to_call");
});

/* T5. Government source is rejected outright */
test("[source-quality] municipal/government domain results are rejected", async () => {
  const snippet = `Ville de Montréal — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Gestion ABC Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Ville de Montréal — Services", snippet, url: "https://www.ville.montreal.qc.ca/services" },
    ]),
  });
  const r = results[0];
  assert.equal(r.status, "no_contact_found");
  assert.equal(r.bestPhone, null);
  assert.ok(r.evidence.some((e) => /rejected.*government/.test(e)),
    "expected explicit government-rejection evidence");
});

/* T6. B2BHint result becomes profile + triggers expansion */
test("[profile] B2BHint result triggers profile expansion + director discovery", async () => {
  const profileResult = {
    title: "9338-8387 Québec Inc. - B2BHint",
    snippet: "NEQ: 9338-8387-12. Dirigeants: Jean Tremblay, Marie Dupont. Adresse: 123 rue Fictive, Montréal.",
    url: "https://b2bhint.com/qc/9338-8387",
  };
  const directorResult = {
    title: "Jean Tremblay",
    snippet: `Investisseur immobilier — ${PHONE_555}`,
    url: "https://example-tremblay.ca",
  };
  let queryNum = 0;
  const stagedSearch = async (q) => {
    queryNum += 1;
    // First query → return the profile result.
    // Subsequent queries (expansion) → return director result.
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [directorResult] };
  };
  const pkg = makePkg({
    lead_owner_name: "9338-8387 Québec Inc.",
    legal_entity_category: "numbered_company",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
  });
  const r = results[0];
  assert.ok(r.evidence.some((e) => /company_profile:/.test(e)),
    "profile extraction evidence missing");
  assert.ok(r.evidence.some((e) => /profile_expansion:/.test(e)),
    "profile expansion evidence missing");
});

/* T7. Profile result without phone is NOT a contact */
test("[profile] profile result without phone in snippet does NOT become bestPhone", async () => {
  // Profile snippet has NO phone → contributes evidence + expansion only.
  const profileResult = {
    title: "Société ABC - B2BHint",
    snippet: "NEQ: 1234567890. Dirigeants: Marie Test. Adresse: 99 rue Inconnue.",
    url: "https://b2bhint.com/qc/1234567890",
  };
  let queryNum = 0;
  const stagedSearch = async (q) => {
    queryNum += 1;
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [] };
  };
  const pkg = makePkg({
    lead_owner_name: "Société ABC",
    legal_entity_category: "society",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
  });
  const r = results[0];
  // No phone in profile snippet, no phone returned by expansion → no bestPhone.
  assert.equal(r.bestPhone, null);
  assert.ok(r.evidence.some((e) => /company_profile:/.test(e)));
});

/* T8. Junk email prefixes are rejected */
test("[email] noreply/privacy/abuse/legal/webmaster prefixes are dropped", async () => {
  const snippet = `Contact: noreply@example.com, privacy@example.com, contact@example.com, ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Gestion Test Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Gestion Test Inc.", snippet, url: "https://gestion-test.ca" },
    ]),
  });
  const r = results[0];
  const emails = r.emailCandidates.map((e) => e.email);
  assert.ok(!emails.includes("noreply@example.com"), "noreply@ should be filtered");
  assert.ok(!emails.includes("privacy@example.com"), "privacy@ should be filtered");
  assert.ok(emails.includes("contact@example.com"), "contact@ should be kept");
});

/* T9. ready_to_email status when only a strong email is found */
test("[email] no phone but strong email → ready_to_email", async () => {
  const snippet = `Contactez-nous: contact@gestion-test.ca`;
  const pkg = makePkg({
    lead_owner_name: "Gestion Test Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Gestion Test Inc.", snippet, url: "https://gestion-test.ca" },
    ]),
  });
  const r = results[0];
  assert.equal(r.bestPhone, null);
  assert.equal(r.bestEmail, "contact@gestion-test.ca");
  assert.equal(r.status, "ready_to_email");
});

/* T10. Email export fields are populated */
test("[email] export shape includes owner/relationship/confidence/source_url/evidence", async () => {
  const snippet = `Contact: info@gestion-test.ca`;
  const pkg = makePkg({
    lead_owner_name: "Gestion Test Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Gestion Test Inc.", snippet, url: "https://gestion-test.ca" },
    ]),
  });
  const r = results[0];
  const e = r.emailCandidates[0];
  assert.ok(e);
  assert.equal(e.email, "info@gestion-test.ca");
  assert.ok("email_owner_name" in e);
  assert.ok("relationship_to_lead_owner" in e);
  assert.ok("confidence" in e);
  assert.ok("source_url" in e);
  assert.ok("evidence" in e);
});

/* T11. Co-owner entity match → company_discovered_from_same_mailing_address evidence */
test("[address-discovery] phone tagged with company_discovered_from_same_mailing_address", async () => {
  // Address discovery is the only track that runs (mailing_address_only strategy);
  // first-set wins on relationship, so the candidate keeps the new label.
  const snippet = `Société ABC — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "9338-8387 Québec Inc.",
    legal_entity_category: "numbered_company",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [], // legacy step skipped
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Société ABC", snippet, url: "https://societe-abc.ca" },
    ]),
  });
  const r = results[0];
  assert.equal(r.bestPhone, PHONE_555);
  assert.equal(r.phoneRelationship, "company_discovered_from_same_mailing_address");
});

/* T12. mailingAddresses[] is honored for query generation (multi-address slot) */
test("[address-discovery] honors pkg.mailingAddresses[] over flat fields", async () => {
  let queries = [];
  const captureSearch = async (q) => {
    queries.push(q);
    return { ok: true, results: [] };
  };
  const pkg = makePkg({
    lead_owner_name: "Multi-addr Inc.",
    legal_entity_category: "inc_ltee",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
    mailing_address: "FLAT-FIELD",
    mailingAddresses: [
      { street: "789 boul. Test", city: "Sherbrooke", province: "QC", postalCode: "J1A 1A1" },
    ],
  });
  await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: captureSearch,
  });
  // Should query the structured address, NOT the flat "FLAT-FIELD".
  assert.ok(queries.some((q) => /Sherbrooke/.test(q)));
  assert.ok(!queries.some((q) => /FLAT-FIELD/.test(q)),
    "flat mailing_address should be ignored when mailingAddresses[] is populated");
});

/* T13. Existing same_mailing_address_contact label is preserved (no regression) */
test("[regression] legacy mailing-discovery still produces same_mailing_address_contact", async () => {
  const snippet = `Boulangerie Tessier — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Fiducie Tessier",
    legal_entity_category: "trust",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal"],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Boulangerie Tessier", snippet, url: "https://boulangerie-tessier.ca" },
    ]),
  });
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  // Legacy step 3 records first → first-set wins, relationship stays
  // same_mailing_address_contact (no RE keyword) even though step 4a runs after.
  assert.equal(r.phoneRelationship, "same_mailing_address_contact");
});

/* T14. Co-owner email upgrade */
test("[coowner-email] co-owner exact name on email source upgrades confidence", async () => {
  const snippet = `Marie Tremblay — marie@example.ca`;
  const pkg = makePkg({
    lead_owner_name: "9338-8387 Québec Inc.",
    legal_entity_category: "numbered_company",
    search_strategy: "direct_entity_then_mailing_address_related_companies",
    coOwnerNames: ["Marie Tremblay"],
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Marie Tremblay", snippet, url: "https://example.ca" },
    ]),
  });
  const r = results[0];
  // Email confidence should be at least medium after the co-owner upgrade pass.
  const e = r.emailCandidates.find((x) => x.email === "marie@example.ca");
  assert.ok(e, "email candidate should exist");
  assert.ok(["medium", "medium-high", "high"].includes(e.confidence),
    `expected upgraded confidence, got ${e.confidence}`);
});

/* T15. Source-quality classifier path: directory results need name match */
test("[source-quality] directory-only result without name match → not ready_to_call", async () => {
  const snippet = `Gestion XYZ - Pages Jaunes — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "Gestion ABC Inc.",
    legal_entity_category: "gestion",
    search_strategy: "direct_entity",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([
      { title: "Gestion XYZ - Pages Jaunes", snippet, url: "https://www.pagesjaunes.ca/x" },
    ]),
  });
  const r = results[0];
  // Title says XYZ, owner is ABC → no name match. Directory path requires
  // explicit name match to clear ready_to_call.
  assert.notEqual(r.status, "ready_to_call");
});

/* ─── Choinière regression: person last-name overlap is not nameMatch ───── */

test("[choiniere] B2BHint director Mathieu vs result Jonathan — does NOT become ready_to_call", async () => {
  // Owner is the company. B2BHint profile lists Mathieu Choinière as a
  // director. Profile-expansion query then surfaces "Jonathan Choinière,
  // Courtier Immobilier" — same family name only. Must NOT promote to
  // ready_to_call from that signal alone.
  const profileResult = {
    title: "Gestion Immobilière Choinière Inc. - B2BHint",
    snippet: "NEQ: 1166869975. Dirigeants: Mathieu Choinière. Adresse: 595 rue de l'Émeraude, Bromont.",
    url: "https://b2bhint.com/fr/company/ca-qc/gestion-immobiliere-choiniere-inc--1166869975",
  };
  const personResult = {
    title: "Jonathan Choinière, Courtier Immobilier",
    snippet: `Equipe Choinière Gaucher — ${PHONE_555}`,
    url: "https://example-broker.ca",
  };
  let queryNum = 0;
  const stagedSearch = async () => {
    queryNum += 1;
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [personResult] };
  };
  const pkg = makePkg({
    lead_owner_name: "GESTION IMMOBILIÈRE CHOINIÈRE INC.",
    legal_entity_category: "inc_ltee",
    search_strategy: "mailing_address_only",
    coOwnerNames: [],
    mailing_address: "595 rue de l'Émeraude",
    mailing_city: "Bromont",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
  });
  const r = results[0];
  assert.notEqual(r.status, "ready_to_call",
    "Jonathan Choinière (last-name overlap only, not in directors/co-owners) must not be ready_to_call");
  assert.ok(
    r.evidence.some((e) => /weak_person_last_name_match|profile_director_not_matched|rejected_ready_to_call.*first_name_mismatch/.test(e)),
    "expected weak_person_last_name_match / first_name_mismatch / profile_director_not_matched evidence",
  );
});

test("[choiniere] exact director Mathieu Choinière → ready_to_call via exact_director_match", async () => {
  const profileResult = {
    title: "Gestion Immobilière Choinière Inc. - B2BHint",
    snippet: "NEQ: 1166869975. Dirigeants: Mathieu Choinière. Adresse: 595 rue de l'Émeraude, Bromont.",
    url: "https://b2bhint.com/fr/company/ca-qc/gestion-immobiliere-choiniere-inc--1166869975",
  };
  const directorResult = {
    title: "Mathieu Choinière",
    snippet: `Investisseur immobilier — ${PHONE_555}`,
    url: "https://example-mathieu.ca",
  };
  let queryNum = 0;
  const stagedSearch = async () => {
    queryNum += 1;
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [directorResult] };
  };
  const pkg = makePkg({
    lead_owner_name: "GESTION IMMOBILIÈRE CHOINIÈRE INC.",
    legal_entity_category: "inc_ltee",
    search_strategy: "mailing_address_only",
    mailing_address: "595 rue de l'Émeraude",
    mailing_city: "Bromont",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
  });
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.bestPhone, PHONE_555);
});

test("[choiniere] exact co-owner Jonathan in coOwnerNames → ready_to_call via co_owner_match", async () => {
  const profileResult = {
    title: "Gestion Immobilière Choinière Inc. - B2BHint",
    snippet: "NEQ: 1166869975. Dirigeants: Mathieu Choinière. Adresse: 595 rue de l'Émeraude, Bromont.",
    url: "https://b2bhint.com/fr/company/ca-qc/gestion-immobiliere-choiniere-inc--1166869975",
  };
  const personResult = {
    title: "Jonathan Choinière",
    snippet: `Real estate broker — ${PHONE_555}`,
    url: "https://example-jonathan.ca",
  };
  let queryNum = 0;
  const stagedSearch = async () => {
    queryNum += 1;
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [personResult] };
  };
  const pkg = makePkg({
    lead_owner_name: "GESTION IMMOBILIÈRE CHOINIÈRE INC.",
    legal_entity_category: "inc_ltee",
    search_strategy: "mailing_address_only",
    coOwnerNames: ["Jonathan Choinière"],
    mailing_address: "595 rue de l'Émeraude",
    mailing_city: "Bromont",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
  });
  const r = results[0];
  assert.equal(r.status, "ready_to_call");
  assert.equal(r.phoneRelationship, "co_owner_match");
});

/* Live regression: Choinière broker title without comma (no leadingChunk split) */
test("[choiniere-live] 'JONATHAN CHOINIERE real estate broker in Bromont' must NOT ready_to_call", async () => {
  // The actual title that slipped past PR #21 in the live test on Railway.
  // No comma, no separator, 6 tokens — used to be classified as entity by
  // default and then matched on the single shared 'choiniere' token.
  const personResult = {
    title: "JONATHAN CHOINIERE real estate broker in Bromont",
    snippet: `Equipe Choiniere Gaucher Real Estate — 450 534-2147`,
    url: "https://example-jonathan-choiniere.ca",
  };
  const pkg = makePkg({
    lead_owner_name: "GESTION IMMOBILIÈRE CHOINIÈRE INC.",
    legal_entity_category: "inc_ltee",
    search_strategy: "direct_entity_then_mailing_address_related_companies",
    coOwnerNames: [],
    mailing_address: "595 RUE DE L'ÉMERAUDE",
    mailing_city: "Bromont",
    mailing_address_discovery_queries: [],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([personResult]),
  });
  const r = results[0];
  assert.notEqual(r.status, "ready_to_call",
    "broker title with shared family name must not ready_to_call");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  Phase 3.1 — B2BHint page-fetch pipeline tests                              */
/* ──────────────────────────────────────────────────────────────────────────── */

/* P3-T1. B2BHint result with empty snippet directors → fetch fills directors */
test("[b2bhint-fetch] B2BHint profile with no snippet directors triggers page fetch and populates directors", async () => {
  const PHONE_DIR = "(514) 555-0199";
  const DIGITS_DIR = "5145550199";

  // Mocked B2BHint page HTML — has directors not in the snippet.
  const b2bhintPageHtml = `<html><body>
    <dl>
      <dt>Dirigeants</dt>
      <dd>Robert Gosselin, Francine Audet</dd>
    </dl>
  </body></html>`;

  // The search result has NO directors in its snippet.
  const profileResult = {
    title: "Gestion Gosselin Inc. - B2BHint",
    snippet: "NEQ: 1234509876. Adresse: 99 boul. Test, Laval. Aucun dirigeant affiché.",
    url: "https://b2bhint.com/fr/company/ca-qc/gestion-gosselin-inc--1234509876",
  };

  // Expansion query returns a director result.
  const directorResult = {
    title: "Robert Gosselin",
    snippet: `Propriétaire — ${PHONE_DIR}`,
    url: "https://example-gosselin.ca",
  };

  let queryNum = 0;
  const stagedSearch = async (_q) => {
    queryNum += 1;
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [directorResult] };
  };

  const fetchedUrls = [];
  const mockFetchPage = async (url) => {
    fetchedUrls.push(url);
    if (url === profileResult.url) return b2bhintPageHtml;
    return null;
  };

  const pkg = makePkg({
    lead_owner_name: "Gestion Gosselin Inc.",
    legal_entity_category: "inc_ltee",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
  });

  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
    fetchPageFn: mockFetchPage,
    options: { b2bhintFetchEnabled: true }, // Fix 6: opt-in required
  });
  const r = results[0];

  // B2BHint page must have been fetched
  assert.ok(fetchedUrls.includes(profileResult.url), "B2BHint page should have been fetched");

  // evidence must contain b2bhint_fetch line
  assert.ok(
    r.evidence.some((e) => /b2bhint_fetch:/.test(e)),
    `expected b2bhint_fetch evidence, got: ${JSON.stringify(r.evidence)}`,
  );

  // directors from page should have enabled director-based expansion
  // (Robert Gosselin should appear in evidence as a director)
  assert.ok(
    r.evidence.some((e) => /company_profile:.*directors=2/.test(e)),
    `expected directors=2 in company_profile evidence, got: ${JSON.stringify(r.evidence)}`,
  );
});

/* P3-T2. Non-B2BHint profile URL → no page fetch attempt */
test("[b2bhint-fetch] Non-B2BHint profile URL does NOT trigger page fetch", async () => {
  const profileResult = {
    title: "Société ABC - OpenCorporates",
    snippet: "NEQ: 9876543210. Dirigeants: (none listed). Adresse: 77 rue Test, Québec.",
    url: "https://opencorporates.com/companies/ca_qc/9876543210",
  };

  let fetchPageCalled = false;
  const mockFetchPage = async (_url) => {
    fetchPageCalled = true;
    return null;
  };

  let queryNum = 0;
  const stagedSearch = async (_q) => {
    queryNum += 1;
    if (queryNum === 1) return { ok: true, results: [profileResult] };
    return { ok: true, results: [] };
  };

  const pkg = makePkg({
    lead_owner_name: "Société ABC",
    legal_entity_category: "society",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: [],
  });

  await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
    fetchPageFn: mockFetchPage,
  });

  // fetchPageFn should NOT have been called for a non-B2BHint URL
  // (it may be called for top website pages, but not for this OpenCorporates URL)
  // We check that no B2BHint fetch evidence appeared.
  // The mock IS called for the site page-fetch (step 2), so we only check
  // that no b2bhint_fetch evidence was emitted (not that fetchPage was never called).
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: stagedSearch,
    fetchPageFn: mockFetchPage,
  });
  const r = results[0];
  assert.ok(
    !r.evidence.some((e) => /b2bhint_fetch:/.test(e)),
    "b2bhint_fetch evidence should NOT appear for OpenCorporates URL",
  );
});

/* ------------------------------------------------------------------ *
 *  P1 audit fix 2: Widen Places fallback trigger
 * ------------------------------------------------------------------ */

test("Places fallback fires when Brave finds email but no phone", async () => {
  // Brave returns a result with an email in the snippet but no phone.
  // Status should be ready_to_email, bestPhone null. Places fallback runs.
  let placesCalled = false;
  const placesFallbackFn = async () => {
    placesCalled = true;
    return {
      ok: true,
      phone: "(514) 555-0188",
      businessName: "Found via Places",
      address: "100 rue X",
      evidence: [],
    };
  };
  const pkg = makePkg({ /* a package likely to produce ready_to_email but no phone */ });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([{ title: "X", snippet: "info@example.ca", url: "https://example.ca" }]),
    placesFallbackEnabled: true,
    placesFallbackFn,
  });
  assert.equal(placesCalled, true, "Places fallback should have been called");
  assert.equal(results[0].bestPhone, "(514) 555-0188");
});

test("Places fallback does NOT fire when Brave already found a phone", async () => {
  let placesCalled = false;
  const placesFallbackFn = async () => { placesCalled = true; return { ok: true, phone: "x" }; };
  const pkg = makePkg({});
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([{ title: pkg.lead_owner_name, snippet: `${PHONE_555}`, url: "https://x.com" }]),
    placesFallbackEnabled: true,
    placesFallbackFn,
  });
  assert.equal(placesCalled, false, "Places must not run when bestPhone already exists");
});

test("Places fallback does NOT fire when status is skipped_existing_phone", async () => {
  let placesCalled = false;
  const placesFallbackFn = async () => { placesCalled = true; return { ok: true, phone: "x" }; };
  const pkg = makePkg({
    candidatePhones: [{ phone: PHONE_555, relationship_to_lead_owner: "owner" }],
  });
  await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([]),
    placesFallbackEnabled: true,
    placesFallbackFn,
  });
  assert.equal(placesCalled, false);
});

test("Places fallback still works on no_contact_found", async () => {
  // Existing behavior — verify the new condition still covers this case.
  let placesCalled = false;
  const placesFallbackFn = async () => {
    placesCalled = true;
    return { ok: true, phone: "(514) 555-0188", businessName: "X", address: "Y", evidence: [] };
  };
  const pkg = makePkg({});
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    searchFn: okSearch([]),  // no results → no_contact_found
    placesFallbackEnabled: true,
    placesFallbackFn,
  });
  assert.equal(placesCalled, true);
  assert.equal(results[0].bestPhone, "(514) 555-0188");
});
