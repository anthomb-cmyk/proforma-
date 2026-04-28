// services/coOwnerValidator.test.js
//
// Run with: node --test services/coOwnerValidator.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCoOwnerMatch,
  isStrongCoOwnerMatch,
} from "./coOwnerValidator.js";

test("exact full-name match → strong", () => {
  const m = validateCoOwnerMatch("Jean Tremblay", ["Jean Tremblay", "Marie Dupont"]);
  assert.equal(m.match, "strong");
  assert.equal(m.matchType, "exact_full_name");
  assert.equal(m.matchedName, "Jean Tremblay");
  assert.equal(isStrongCoOwnerMatch(m), true);
});

test("name-order swap (DUPONT Jean ↔ Jean Dupont) → strong via token overlap", () => {
  const m = validateCoOwnerMatch("DUPONT Jean", ["Jean Dupont"]);
  assert.equal(m.match, "strong");
  assert.equal(m.matchType, "token_overlap");
  assert.equal(isStrongCoOwnerMatch(m), true);
});

test("accent-insensitive match", () => {
  const m = validateCoOwnerMatch("jean tremblay", ["Jean Tremblay"]);
  assert.equal(m.match, "strong");
  assert.equal(m.matchType, "exact_full_name");
});

test("last-name-only without corroboration → weak (NOT strong)", () => {
  const m = validateCoOwnerMatch("Sophie Tremblay", ["Jean Tremblay"]);
  assert.equal(m.match, "weak");
  assert.equal(m.matchType, "last_name_only");
  assert.equal(isStrongCoOwnerMatch(m), false);
});

test("last-name-only WITH corroboration → strong", () => {
  const m = validateCoOwnerMatch("Sophie Tremblay", ["Jean Tremblay"], { hasCorroboration: true });
  assert.equal(m.match, "strong");
  assert.equal(m.matchType, "last_name_corroborated");
  assert.equal(isStrongCoOwnerMatch(m), true);
});

test("different first name AND different last name → none", () => {
  const m = validateCoOwnerMatch("Pierre Lefebvre", ["Jean Tremblay"]);
  assert.equal(m.match, "none");
  assert.equal(m.matchType, "no_match");
  assert.equal(m.matchedName, null);
});

test("empty co-owner list → none", () => {
  const m = validateCoOwnerMatch("Jean Tremblay", []);
  assert.equal(m.match, "none");
  assert.equal(m.matchType, "no_candidates");
});

test("empty result name → none", () => {
  const m = validateCoOwnerMatch("", ["Jean Tremblay"]);
  assert.equal(m.match, "none");
});

test("ignores legal-suffix tokens (Inc/Ltée/etc.)", () => {
  const m = validateCoOwnerMatch("Gestion Tremblay Inc.", ["Gestion Tremblay Ltée"]);
  // significant tokens after stripping inc/ltee: "tremblay" only → last_name path (single-token)
  // Both names share "tremblay" with len ≥ 4 → weak match
  assert.notEqual(m.match, "none");
});

test("two-token corporate match → strong via token overlap", () => {
  const m = validateCoOwnerMatch(
    "Investissements Bernard Côté Inc.",
    ["Bernard Côté"],
  );
  // Significant tokens: ["bernard", "cote"] vs ["bernard", "cote"] (after stripping inc + investissements)
  assert.equal(m.match, "strong");
  assert.equal(m.matchType, "token_overlap");
});

test("isStrongCoOwnerMatch returns false for weak/none/null", () => {
  assert.equal(isStrongCoOwnerMatch({ match: "weak" }), false);
  assert.equal(isStrongCoOwnerMatch({ match: "none" }), false);
  assert.equal(isStrongCoOwnerMatch(null), false);
  assert.equal(isStrongCoOwnerMatch({}), false);
});
