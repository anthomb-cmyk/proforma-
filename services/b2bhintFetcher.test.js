// services/b2bhintFetcher.test.js
//
// Unit tests for b2bhintFetcher.js — no real HTTP calls.
// Run with: node --test services/b2bhintFetcher.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  isB2BHintProfileUrl,
  extractDirectorsFromHtml,
  fetchAndExtractDirectors,
} from "./b2bhintFetcher.js";

/* ──────────────────────────────────────────────────────────────────────────── */
/*  1. isB2BHintProfileUrl                                                      */
/* ──────────────────────────────────────────────────────────────────────────── */

test("isB2BHintProfileUrl — true for valid B2BHint company URLs", () => {
  assert.equal(isB2BHintProfileUrl("https://b2bhint.com/fr/company/ca-qc/gestion-xyz-inc--1234567890"), true);
  assert.equal(isB2BHintProfileUrl("https://b2bhint.com/en/company/ca-qc/holding-abc--9876543210"), true);
  assert.equal(isB2BHintProfileUrl("https://b2bhint.com/company/ca-qc/fiducie-test--0000000000"), true);
});

test("isB2BHintProfileUrl — false for other domains and non-company B2BHint pages", () => {
  assert.equal(isB2BHintProfileUrl("https://registreentreprises.gouv.qc.ca/foo"), false);
  assert.equal(isB2BHintProfileUrl("https://opencorporates.com/companies/ca_qc/123"), false);
  assert.equal(isB2BHintProfileUrl("https://example.com"), false);
  assert.equal(isB2BHintProfileUrl(""), false);
  assert.equal(isB2BHintProfileUrl(null), false);
  // B2BHint home / search pages — NOT profile pages
  assert.equal(isB2BHintProfileUrl("https://b2bhint.com/"), false);
  assert.equal(isB2BHintProfileUrl("https://b2bhint.com/search?q=test"), false);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  2. extractDirectorsFromHtml — realistic Dirigeants section                  */
/* ──────────────────────────────────────────────────────────────────────────── */

const SAMPLE_HTML = `
<html><head><title>Gestion XYZ Inc. - B2BHint</title></head>
<body>
  <h1>Gestion XYZ Inc.</h1>
  <dl>
    <dt>Dirigeants</dt>
    <dd>Jean Dupont, Marie Martin</dd>
    <dt>NEQ</dt>
    <dd>1234567890</dd>
    <dt>Adresse</dt>
    <dd>123 rue Fictive, Montréal, QC H1A 1A1</dd>
  </dl>
</body></html>
`;

test("extractDirectorsFromHtml — extracts names correctly from Dirigeants section", () => {
  const names = extractDirectorsFromHtml(SAMPLE_HTML);
  assert.ok(names.includes("Jean Dupont"), `expected Jean Dupont in ${JSON.stringify(names)}`);
  assert.ok(names.includes("Marie Martin"), `expected Marie Martin in ${JSON.stringify(names)}`);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  3. extractDirectorsFromHtml — strips parenthetical roles                    */
/* ──────────────────────────────────────────────────────────────────────────── */

const HTML_WITH_ROLES = `
<html><body>
  <dl>
    <dt>Administrateurs</dt>
    <dd>Jean Dupont (Président), Marie Martin (Secrétaire), Paul Leblanc (Trésorier)</dd>
  </dl>
</body></html>
`;

test("extractDirectorsFromHtml — strips parenthetical roles from names", () => {
  const names = extractDirectorsFromHtml(HTML_WITH_ROLES);
  assert.ok(names.includes("Jean Dupont"), `Jean Dupont expected, got ${JSON.stringify(names)}`);
  assert.ok(names.includes("Marie Martin"), `Marie Martin expected, got ${JSON.stringify(names)}`);
  assert.ok(names.includes("Paul Leblanc"), `Paul Leblanc expected, got ${JSON.stringify(names)}`);
  // Role keywords must not appear in any extracted name
  for (const name of names) {
    assert.ok(!/président|secrétaire|trésorier/i.test(name), `role keyword leaked into name: "${name}"`);
  }
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  4. extractDirectorsFromHtml — empty/malformed HTML returns []               */
/* ──────────────────────────────────────────────────────────────────────────── */

test("extractDirectorsFromHtml — empty HTML returns []", () => {
  assert.deepEqual(extractDirectorsFromHtml(""), []);
  assert.deepEqual(extractDirectorsFromHtml(null), []);
  assert.deepEqual(extractDirectorsFromHtml(undefined), []);
  assert.deepEqual(extractDirectorsFromHtml("<html><body></body></html>"), []);
  // Malformed HTML should not throw
  assert.doesNotThrow(() => extractDirectorsFromHtml("<<<>>>}{}{not html at all"));
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  5. fetchAndExtractDirectors — fetchPageFn returns null → not fetched        */
/* ──────────────────────────────────────────────────────────────────────────── */

test("fetchAndExtractDirectors — when fetchPageFn returns null, returns { fetched: false }", async () => {
  const result = await fetchAndExtractDirectors(
    "https://b2bhint.com/fr/company/ca-qc/gestion-xyz--123",
    async () => null,
  );
  assert.equal(result.fetched, false);
  assert.deepEqual(result.directors, []);
  assert.equal("error" in result, false);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  6. fetchAndExtractDirectors — fetchPageFn throws → returns error            */
/* ──────────────────────────────────────────────────────────────────────────── */

test("fetchAndExtractDirectors — when fetchPageFn throws, returns { fetched: false, error }", async () => {
  const result = await fetchAndExtractDirectors(
    "https://b2bhint.com/fr/company/ca-qc/gestion-xyz--123",
    async () => { throw new Error("HTTP 403"); },
  );
  assert.equal(result.fetched, false);
  assert.deepEqual(result.directors, []);
  assert.ok(typeof result.error === "string", "error should be a string");
  assert.ok(result.error.includes("403"), `expected 403 in error, got "${result.error}"`);
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  7. fetchAndExtractDirectors — successful fetch returns directors             */
/* ──────────────────────────────────────────────────────────────────────────── */

test("fetchAndExtractDirectors — successful fetch returns directors from HTML", async () => {
  const mockHtml = `<html><body>
    <dl>
      <dt>Dirigeants</dt>
      <dd>Sophie Tremblay, Luc Fontaine</dd>
    </dl>
  </body></html>`;

  const result = await fetchAndExtractDirectors(
    "https://b2bhint.com/fr/company/ca-qc/test-inc--999",
    async () => mockHtml,
  );
  assert.equal(result.fetched, true);
  assert.ok(result.directors.includes("Sophie Tremblay"), JSON.stringify(result.directors));
  assert.ok(result.directors.includes("Luc Fontaine"), JSON.stringify(result.directors));
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  8. extractDirectorsFromHtml — deduplication                                 */
/* ──────────────────────────────────────────────────────────────────────────── */

test("extractDirectorsFromHtml — deduplicates repeated names", () => {
  const html = `<html><body>
    <dl>
      <dt>Dirigeants</dt><dd>Jean Dupont, Jean Dupont, Marie Martin</dd>
      <dt>Administrateurs</dt><dd>Jean Dupont</dd>
    </dl>
  </body></html>`;
  const names = extractDirectorsFromHtml(html);
  const dupCount = names.filter((n) => n === "Jean Dupont").length;
  assert.equal(dupCount, 1, "Jean Dupont should appear exactly once");
});

/* ──────────────────────────────────────────────────────────────────────────── */
/*  9. extractDirectorsFromHtml — th/td table pattern                           */
/* ──────────────────────────────────────────────────────────────────────────── */

test("extractDirectorsFromHtml — extracts from th/td table pattern", () => {
  const html = `<html><body>
    <table>
      <tr><th>Président</th><td>René Lafleur</td></tr>
      <tr><th>Secrétaire</th><td>Isabelle Caron</td></tr>
      <tr><th>Adresse</th><td>456 av. Test, Québec</td></tr>
    </table>
  </body></html>`;
  const names = extractDirectorsFromHtml(html);
  assert.ok(names.includes("René Lafleur"), JSON.stringify(names));
  assert.ok(names.includes("Isabelle Caron"), JSON.stringify(names));
  // Address should NOT appear as a director
  assert.ok(!names.some((n) => /456|av\.|Test|Québec/i.test(n)), "address should not be a director");
});
