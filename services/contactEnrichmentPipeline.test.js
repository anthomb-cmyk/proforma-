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
 *  15. Fiducie + related real-estate company at same address → needs_review, not ready_to_call
 * ------------------------------------------------------------------ */

test("fiducie with related RE company phone stays needs_review, not ready_to_call", async () => {
  // The mailing query returns a real-estate company co-located with the fiducie.
  // Score for a mailing-sourced phone (even with nameMatch) is max 2 (low) per
  // single occurrence, so it must NOT become bestPhone and MUST NOT be ready_to_call.
  const snippet = `Immobilier Dupont Inc. — ${PHONE_555}`;
  const pkg = makePkg({
    lead_owner_name: "FIDUCIE DUPONT",
    legal_entity_category: "trust",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });
  const results = await runContactEnrichmentPreview({
    packages: [pkg],
    // First call: mailing query → returns RE company
    // Second call: related company search → returns same phone again
    searchFn: okSearch([
      { title: "Immobilier Dupont Inc.", snippet, url: "https://immodupont.ca" },
    ]),
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.notEqual(r.status, "ready_to_call", "fiducie related-company phone must not be ready_to_call");
  // Candidate may or may not have been found, but if bestPhone is set it must be needs_review
  if (r.bestPhone !== null) {
    assert.equal(r.status, "needs_review");
  }
});

/* ------------------------------------------------------------------ *
 *  16. Directory fallback: exact company name match from Pages Jaunes
 * ------------------------------------------------------------------ */

test("directory fallback: exact company match from Pages Jaunes produces needs_review with bestPhone", async () => {
  // Steps 1–5 return nothing; directory fallback fires and finds the company
  // listed on pagesjaunes.ca with a matching title.
  const searchSpy = async (q) => {
    if (q.includes("pagesjaunes.ca") || q.includes("411.ca")) {
      const snippet = `Immobilier Fictif Inc. — ${PHONE_555}`;
      return {
        ok: true,
        results: [{ title: "Immobilier Fictif Inc.", snippet, url: "https://pagesjaunes.ca/immobilier-fictif/123" }],
      };
    }
    return { ok: true, results: [] };
  };
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: searchSpy,
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.bestPhone, PHONE_555, "directory phone should be promoted to bestPhone");
  assert.equal(r.status, "needs_review", "directory result must produce needs_review, not ready_to_call");
  assert.notEqual(r.status, "ready_to_call");
});

/* ------------------------------------------------------------------ *
 *  17. Directory fallback: unrelated title is rejected
 * ------------------------------------------------------------------ */

test("directory fallback: unrelated directory title is rejected and bestPhone stays null", async () => {
  // The directory returns a business with no name overlap with the owner.
  const searchSpy = async (q) => {
    if (q.includes("pagesjaunes.ca") || q.includes("411.ca")) {
      return {
        ok: true,
        results: [{ title: "Boutique Tendance XYZW", snippet: `Appelez: ${PHONE_555}`, url: "https://pagesjaunes.ca/boutique/456" }],
      };
    }
    return { ok: true, results: [] };
  };
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: searchSpy,
  });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.bestPhone, null, "unrelated directory result must not produce bestPhone");
  assert.ok(
    r.evidence.some((e) => e.includes("rejected_directory")),
    "evidence must record rejected_directory",
  );
});

/* ------------------------------------------------------------------ *
 *  18. Directory fallback: individual owner triggers no directory queries
 * ------------------------------------------------------------------ */

test("directory fallback: individual owner triggers no directory queries", async () => {
  const queriesUsed = [];
  const searchSpy = async (q) => {
    queriesUsed.push(q);
    return { ok: true, results: [] };
  };
  const pkg = makePkg({
    lead_owner_name: "Sophie Bouchard",
    legal_entity_category: "individual",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });
  await runContactEnrichmentPreview({ packages: [pkg], searchFn: searchSpy });
  const dirQueries = queriesUsed.filter(
    (q) => q.includes("pagesjaunes.ca") || q.includes("411.ca"),
  );
  assert.equal(dirQueries.length, 0, "individual owner must not trigger directory queries");
});

/* ------------------------------------------------------------------ *
 *  19. Directory fallback: related RE company phone accepted as needs_review
 * ------------------------------------------------------------------ */

test("directory fallback: related RE company phone from directory accepted as needs_review", async () => {
  // Mailing query finds a gestion/immobilier company co-located with the fiducie.
  // The direct and mailing steps produce no phone; the directory fallback then
  // searches for the RE company on pagesjaunes.ca and finds a number.
  const pkg = makePkg({
    lead_owner_name: "FIDUCIE IMMOBILIA",
    legal_entity_category: "trust",
    search_strategy: "mailing_address_only",
    mailing_address_discovery_queries: ["123 rue Fictive, Montréal, QC"],
  });
  const searchSpy = async (q) => {
    if (q === "123 rue Fictive, Montréal, QC") {
      return {
        ok: true,
        results: [{ title: "Gestion Immobilia Inc.", snippet: "Services de gestion immobilière.", url: "https://gestionimmobilia.ca" }],
      };
    }
    if (q === "Gestion Immobilia Inc.") {
      return {
        ok: true,
        results: [{ title: "Gestion Immobilia Inc.", snippet: "Expertise en gestion.", url: "https://gestionimmobilia.ca" }],
      };
    }
    if (q.includes("Gestion Immobilia") && (q.includes("pagesjaunes.ca") || q.includes("411.ca"))) {
      return {
        ok: true,
        results: [{ title: "Gestion Immobilia Inc.", snippet: `Tél: ${PHONE_555}`, url: "https://pagesjaunes.ca/gestionimmobilia/789" }],
      };
    }
    return { ok: true, results: [] };
  };
  const results = await runContactEnrichmentPreview({ packages: [pkg], searchFn: searchSpy });
  assert.equal(results.length, 1);
  const r = results[0];
  assert.notEqual(r.bestPhone, null, "related RE company directory phone should become bestPhone");
  assert.equal(r.status, "needs_review", "related RE company must produce needs_review");
});

/* ------------------------------------------------------------------ *
 *  20. Directory fallback: evidence records directory source and URL
 * ------------------------------------------------------------------ */

test("directory fallback: evidence records directory source and URL", async () => {
  const dirUrl = "https://www.pagesjaunes.ca/bus/QC/Montreal/ImmobilierFictif/987654";
  const snippet = `Immobilier Fictif Inc. — ${PHONE_555}`;
  const searchSpy = async (q) => {
    if (q.includes("pagesjaunes.ca")) {
      return { ok: true, results: [{ title: "Immobilier Fictif Inc.", snippet, url: dirUrl }] };
    }
    return { ok: true, results: [] };
  };
  const results = await runContactEnrichmentPreview({
    packages: [makePkg()],
    searchFn: searchSpy,
  });
  assert.equal(results.length, 1);
  const r = results[0];
  const dirCandidate = r.phoneCandidates.find((c) => c.source === "pages_jaunes");
  assert.ok(dirCandidate, "should find a pages_jaunes phone candidate");
  assert.equal(dirCandidate.url, dirUrl, "candidate URL should match the directory listing URL");
  assert.ok(
    r.evidence.some((e) => e.includes("pages_jaunes")),
    "evidence must mention pages_jaunes",
  );
});
