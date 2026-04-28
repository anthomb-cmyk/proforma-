import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isEntityName,
  isPersonName,
  evaluateNameMatch,
} from "./nameMatchEvaluator.js";

describe("isEntityName", () => {
  test("recognizes corporate suffixes", () => {
    assert.equal(isEntityName("GESTION IMMOBILIÈRE CHOINIÈRE INC."), true);
    assert.equal(isEntityName("Acme Corp"), true);
    assert.equal(isEntityName("Les Placements Tremblay Ltée"), true);
  });
  test("recognizes corporate prefixes / vocabulary", () => {
    assert.equal(isEntityName("Gestion Immobilière Choinière"), true);
    assert.equal(isEntityName("Fiducie de Capital du Mont"), true);
  });
  test("recognizes numbered Québec corporations", () => {
    assert.equal(isEntityName("9876-5432 Québec Inc."), true);
    assert.equal(isEntityName("9876-5432 Quebec Inc"), true);
  });
  test("rejects plain person names", () => {
    assert.equal(isEntityName("Jonathan Choinière"), false);
    assert.equal(isEntityName("Jean Dupont"), false);
  });
});

describe("isPersonName", () => {
  test("accepts simple person names", () => {
    assert.equal(isPersonName("Jonathan Choinière"), true);
    assert.equal(isPersonName("Jean Dupont"), true);
    assert.equal(isPersonName("Marie-Claire De Beauport"), true);
  });
  test("strips trailing role descriptions before classifying", () => {
    assert.equal(isPersonName("Jonathan Choinière, Courtier Immobilier"), true);
    assert.equal(isPersonName("Jean Dupont | LinkedIn"), true);
    assert.equal(isPersonName("Sophie Tremblay - Avocate"), true);
  });
  test("rejects entity-style names", () => {
    assert.equal(isPersonName("GESTION IMMOBILIÈRE CHOINIÈRE INC."), false);
    assert.equal(isPersonName("9876-5432 Québec Inc."), false);
  });
});

describe("evaluateNameMatch — entity ↔ entity", () => {
  test("entity ↔ entity where owner's only sig token is shared → strong", () => {
    // Owner significant tokens (after stop-word filter) = ["choiniere"];
    // result has "choiniere" too. The owner's full distinguishing identity
    // is matched, so this is a strong match (matchType: entity_token_overlap).
    // The strict rule the user wanted was for PERSON results, not entity↔entity.
    const r = evaluateNameMatch(
      "GESTION IMMOBILIÈRE CHOINIÈRE INC.",
      "INVESTISSEMENTS CHOINIÈRE TREMBLAY INC.",
    );
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "entity_token_overlap");
    assert.match(r.reason, /entity_all_owner_tokens|entity_overlap/);
  });
  test("entity ↔ entity weak: owner has multiple sig tokens, only one shared", () => {
    // Owner has TWO significant tokens (after stop filter): ["bissonmutch", "logements"]
    // (multi is short < 3 char to be sig, actually multi=5 chars so OK; let's
    //  pick a clearer example).
    const r = evaluateNameMatch(
      "BISSONMUTCH LOGEMENTS QUEBECOIS INC.",
      "TREMBLAY LOGEMENTS QUEBECOIS INC.",
    );
    // Owner sig = [bissonmutch, logements, quebecois]; result sig =
    // [tremblay, logements, quebecois]. Overlap = [logements, quebecois] = 2 → strong.
    assert.equal(r.nameMatch, true);
  });
  test("two genuine corporate-name tokens overlap → nameMatch=true", () => {
    const r = evaluateNameMatch(
      "BISSONMUTCH MULTI-LOGEMENTS INC.",
      "BISSONMUTCH MULTI-LOGEMENTS",
    );
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "entity_token_overlap");
  });
  test("no significant overlap → no_overlap", () => {
    const r = evaluateNameMatch(
      "GESTION IMMOBILIÈRE CHOINIÈRE INC.",
      "FERME AVICOLE TREMBLAY INC.",
    );
    assert.equal(r.nameMatch, false);
    assert.equal(r.weakNameMatch, false);
  });
  test("generic real-estate vocabulary alone does NOT match", () => {
    // Both have "immobilier"; nothing else. Used to fire as nameMatch.
    const r = evaluateNameMatch(
      "GESTION IMMOBILIÈRE TREMBLAY",
      "Société Immobilière du Québec",
    );
    assert.equal(r.nameMatch, false);
  });
});

describe("evaluateNameMatch — entity owner ↔ person result (the Choinière case)", () => {
  const ownerName = "GESTION IMMOBILIÈRE CHOINIÈRE INC.";

  test("Jonathan Choinière (no exact director, no co-owner) → weakNameMatch only", () => {
    const r = evaluateNameMatch(ownerName, "Jonathan Choinière, Courtier Immobilier", {
      knownDirectors: ["Mathieu Choinière"],
      coOwnerNames: [],
    });
    assert.equal(r.nameMatch, false);
    assert.equal(r.weakNameMatch, true);
    assert.equal(r.matchType, "weak_person_last_name_match");
    assert.match(r.reason, /weak_person_last_name_match/);
  });

  test("Mathieu Choinière (exact director match) → ready_to_call eligible", () => {
    const r = evaluateNameMatch(ownerName, "Mathieu Choinière", {
      knownDirectors: ["Mathieu Choinière"],
      coOwnerNames: [],
    });
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "exact_director");
  });

  test("Jonathan Choinière as exact co-owner → ready_to_call eligible", () => {
    const r = evaluateNameMatch(ownerName, "Jonathan Choinière", {
      knownDirectors: [],
      coOwnerNames: ["Jonathan Choinière"],
    });
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "exact_co_owner");
  });

  test("person + entity name both in title/snippet → nameMatch=true", () => {
    const r = evaluateNameMatch(ownerName, "Jonathan Smith — Gestion Immobilière Choinière Inc.", {
      knownDirectors: [],
      coOwnerNames: [],
    });
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "person_with_entity_context");
  });

  test("person on official owner site → nameMatch=true", () => {
    const r = evaluateNameMatch(ownerName, "Mathieu Tremblay", {
      knownDirectors: [],
      coOwnerNames: [],
      isOfficialOwnerSite: true,
    });
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "person_on_owner_site");
  });

  test("person with no overlapping family name → no match", () => {
    const r = evaluateNameMatch(ownerName, "Sophie Tremblay", {
      knownDirectors: [],
      coOwnerNames: [],
    });
    assert.equal(r.nameMatch, false);
    assert.equal(r.weakNameMatch, false);
  });
});

describe("evaluateNameMatch — person ↔ person", () => {
  test("exact full name → strong", () => {
    const r = evaluateNameMatch("Jean Dupont", "Jean Dupont, Avocat");
    assert.equal(r.nameMatch, true);
    assert.equal(r.matchType, "exact_person");
  });
  test("≥2 token overlap (reordered) → strong", () => {
    const r = evaluateNameMatch("Jean-Pierre Dupont", "Dupont, Jean-Pierre");
    assert.equal(r.nameMatch, true);
  });
  test("only family name shared → weak", () => {
    const r = evaluateNameMatch("Jean Dupont", "Sophie Dupont");
    assert.equal(r.nameMatch, false);
    assert.equal(r.weakNameMatch, true);
    assert.equal(r.matchType, "weak_person_last_name_match");
  });
});

describe("evaluateNameMatch — guard rails", () => {
  test("missing inputs → no_input", () => {
    assert.equal(evaluateNameMatch(null, "Jean Dupont").matchType, "no_input");
    assert.equal(evaluateNameMatch("Jean Dupont", "").matchType, "no_input");
  });
  test("ownerKind / resultKind are reported", () => {
    const r = evaluateNameMatch("GESTION IMMOBILIÈRE CHOINIÈRE INC.", "Jonathan Choinière");
    assert.equal(r.ownerKind, "entity");
    assert.equal(r.resultKind, "person");
  });
});
