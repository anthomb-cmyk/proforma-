// Unit tests for services/phoneLookupPlanner.js
//
// Run with:  node --test services/phoneLookupPlanner.test.js
//
// We pin down two categories of behavior:
//   1) Pure helpers — normalizeStreet / normalizePostal / buildOwnerKey /
//      parsePostalAddress / normalizeHeaderKey / pickRowFields /
//      buildRowDigest — are deterministic and don't hit any network.
//   2) planPhoneLookups end-to-end, with openaiClient = null so every row
//      flows through either the file-phone pre-filter or the deterministic
//      fallback path.

import test from "node:test";
import assert from "node:assert/strict";
import {
  planPhoneLookups,
  normalizeStreet,
  normalizePostal,
  buildOwnerKey,
  parsePostalAddress,
  normalizeHeaderKey,
  pickRowFields,
  buildRowDigest,
  buildBatchPrompt,
} from "./phoneLookupPlanner.js";

/* ------------------------------------------------------------------ *
 *  Pure helpers
 * ------------------------------------------------------------------ */

test("normalizeStreet drops accents, street-type words, unit markers", () => {
  assert.equal(
    normalizeStreet("217 rue Saint-Jacques, app. 3"),
    "217 saint jacques",
  );
  assert.equal(
    normalizeStreet("100 boul. René-Lévesque Est"),
    "100 rene levesque est",
  );
  assert.equal(
    normalizeStreet("5000 Avenue des Pins #204"),
    "5000 des pins",
  );
  assert.equal(normalizeStreet(""), "");
  assert.equal(normalizeStreet(null), "");
  // Different surface forms of the same address collapse to the same key.
  assert.equal(
    normalizeStreet("217 Saint-Jacques"),
    normalizeStreet("217 rue St-Jacques"),
  );
});

test("normalizePostal lowercases, strips spaces, validates shape", () => {
  assert.equal(normalizePostal("H2Y 1M6"), "h2y1m6");
  assert.equal(normalizePostal("h2y1m6"), "h2y1m6");
  assert.equal(normalizePostal("J4K-1A1"), ""); // hyphen isn't valid
  assert.equal(normalizePostal("12345"), "");
  assert.equal(normalizePostal(""), "");
  assert.equal(normalizePostal(null), "");
});

test("buildOwnerKey combines street + postal; returns '' when both empty", () => {
  assert.equal(
    buildOwnerKey("217 rue Saint-Jacques", "H2Y 1M6"),
    "217 saint jacques|h2y1m6",
  );
  // Same physical address, different rôle rows.
  assert.equal(
    buildOwnerKey("217 Saint-Jacques", "H2Y 1M6"),
    buildOwnerKey("217 rue St-Jacques app. 3", "h2y1m6"),
  );
  assert.equal(buildOwnerKey("", ""), "");
  // Postal-only (e.g. rural) still forms a usable key.
  assert.equal(buildOwnerKey("", "H2Y 1M6"), "|h2y1m6");
});

test("parsePostalAddress splits street, city, province, postalCode", () => {
  const r = parsePostalAddress("217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6");
  assert.equal(r.street, "217 rue Saint-Jacques");
  assert.equal(r.city, "Montréal");
  assert.equal(r.province, "Québec");
  assert.equal(r.postalCode, "H2Y 1M6");
});

test("parsePostalAddress handles a leading comma inside the street name", () => {
  const r = parsePostalAddress("100, rue Saint-Jacques, Montréal (Québec) H2Y 1M6");
  // Last-comma split keeps the leading "100," with the street.
  assert.equal(r.street, "100, rue Saint-Jacques");
  assert.equal(r.city, "Montréal");
  assert.equal(r.postalCode, "H2Y 1M6");
});

test("parsePostalAddress returns empty fields on empty input", () => {
  const r = parsePostalAddress("");
  assert.deepEqual(r, { street: "", city: "", province: "", postalCode: "" });
});

test("normalizeHeaderKey folds accents, underscores, whitespace", () => {
  assert.equal(normalizeHeaderKey("Adresse_Postale 2"), "adresse postale 2");
  assert.equal(normalizeHeaderKey("Propriétaire"), "proprietaire");
  assert.equal(normalizeHeaderKey("  Ville  "), "ville");
});

/* ------------------------------------------------------------------ *
 *  Row field picking
 * ------------------------------------------------------------------ */

test("pickRowFields extracts building + owner slots; prefers Personne morale", () => {
  const row = {
    "Adresse Immeuble": "5000 Rue Principale",
    "Ville": "Longueuil",
    "Code Postal Immeuble": "J4K 1A1",
    "Utilisation prédominante": "Logement",
    "Lat": "45.55",
    "Lon": "-73.51",
    "Propriétaire": "Jean Tremblay",
    "Statut aux fins d'imposition scolaire": "Personne physique",
    "Adresse postale": "5000 Rue Principale, Longueuil (Québec) J4K 1A1",
    "Propriétaire 2": "9440-5222 Québec Inc",
    "Statut aux fins d'imposition scolaire 2": "Personne morale",
    "Adresse postale 2": "217 Saint-Jacques, Montréal (Québec) H2Y 1M6",
  };
  const fields = pickRowFields(row);
  assert.equal(fields.building.address, "5000 Rue Principale");
  assert.equal(fields.building.postalCode, "J4K 1A1");
  assert.equal(fields.building.utilisation, "Logement");
  assert.equal(fields.building.lat, 45.55);
  assert.equal(fields.owners.length, 2);
  // Primary = morale, regardless of slot order.
  assert.equal(fields.primaryOwner.name, "9440-5222 Québec Inc");
  assert.equal(fields.primaryOwner.postalStreet, "217 Saint-Jacques");
  assert.equal(fields.primaryOwner.postalCode, "H2Y 1M6");
});

test("pickRowFields accepts wide-format rôle headers (Propriétaire1_Nom etc.)", () => {
  // This is the real-world column layout from the cleaned Victoriaville
  // rôle export. Before the fix, pickRowFields only looked at the
  // narrow-form headers (Propriétaire, Adresse postale …) and returned
  // zero owners for this shape, which sent every row to skip_no_lead.
  const row = {
    "Ville": "VILLE DE VICTORIAVILLE",
    "Adresse Immeuble": "9, PLACE DE BIGARRE",
    "Utilisation Prédominante": "Logement",
    "Code Postal Immeuble": "G6T 1L6",
    "Propriétaire1_Nom": "2736-6467 QUEBEC INC.",
    "Propriétaire1_StatutImpositionScolaire": "Morale",
    "Propriétaire1_Adresse": "27 rue Saint-Augustin Victoriaville, Qc, G6P3K8 Canada",
    "Propriétaire2_Nom": "Stéphane Tardif",
    "Propriétaire2_StatutImpositionScolaire": "Physique",
    "Propriétaire2_Adresse": "27 rue Saint-Augustin Victoriaville (Québec) G6P3K8 Canada",
  };
  const fields = pickRowFields(row);
  assert.equal(fields.owners.length, 2);
  // Primary owner = morale (even though it's slot 1 here, the rule is
  // "prefer morale regardless of slot order").
  assert.equal(fields.primaryOwner.name, "2736-6467 QUEBEC INC.");
  assert.equal(fields.primaryOwner.status, "Morale");
  assert.equal(fields.primaryOwner.postalCode, "G6P3K8");
  assert.equal(fields.primaryOwner.postalStreet, "27 rue Saint-Augustin Victoriaville");
});

test("pickRowFields returns empty primaryOwner when no owners on row", () => {
  const fields = pickRowFields({ "Adresse Immeuble": "1 Test St" });
  assert.equal(fields.owners.length, 0);
  assert.equal(fields.primaryOwner, null);
});

test("buildRowDigest yields compact owner list", () => {
  const row = {
    "Adresse Immeuble": "5000 Rue Principale",
    "Ville": "Longueuil",
    "Utilisation prédominante": "Logement",
    "Propriétaire": "Jean Tremblay",
    "Statut aux fins d'imposition scolaire": "Personne physique",
    "Téléphone": "(514) 555-0199",
  };
  const { digest } = buildRowDigest(row, 7);
  assert.equal(digest.rowIdx, 7);
  assert.equal(digest.building.city, "Longueuil");
  assert.equal(digest.owners[0].name, "Jean Tremblay");
  assert.equal(digest.owners[0].hasPhoneInFile, true);
});

/* ------------------------------------------------------------------ *
 *  Prompt shape
 * ------------------------------------------------------------------ */

test("buildBatchPrompt includes the system instructions and JSON user payload", () => {
  const { system, user } = buildBatchPrompt([{ rowIdx: 0 }]);
  assert.ok(system.includes("owner_postal"));
  assert.ok(system.includes("skip"));
  // user is valid JSON wrapping the digests under "rows".
  const parsed = JSON.parse(user);
  assert.deepEqual(parsed, { rows: [{ rowIdx: 0 }] });
});

/* ------------------------------------------------------------------ *
 *  planPhoneLookups — end-to-end, openaiClient = null path
 *
 *  When the OpenAI client is null, every row is either:
 *    - use_file_phone (pre-filter found a valid NANP phone), or
 *    - one of the deterministic fallback outcomes
 *      (enrich_owner_postal or skip_no_lead).
 * ------------------------------------------------------------------ */

test("planPhoneLookups tags rows with file phones as use_file_phone", async () => {
  const rows = [
    {
      "Adresse Immeuble": "5000 Rue Principale",
      "Ville": "Longueuil",
      "Code Postal Immeuble": "J4K 1A1",
      "Utilisation prédominante": "Logement",
      "Propriétaire": "9440-5222 Québec Inc",
      "Statut aux fins d'imposition scolaire": "Personne morale",
      "Adresse postale": "217 Saint-Jacques, Montréal (Québec) H2Y 1M6",
      "Téléphone": "(514) 555-0199",
    },
  ];
  const { plans, stats } = await planPhoneLookups({ rows, openaiClient: null });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].strategy, "use_file_phone");
  assert.ok(plans[0].filePhones.includes("(514) 555-0199"));
  assert.equal(plans[0].plannedQuery, null);
  // Owner shape is still populated so downstream grouping works.
  assert.equal(plans[0].owner.displayName, "9440-5222 Québec Inc");
  assert.equal(plans[0].owner.ownerKey, "217 saint jacques|h2y1m6");
  assert.equal(stats.useFilePhone, 1);
  assert.equal(stats.gptCallCount, 0);
});

test("planPhoneLookups falls back to deterministic plan when openaiClient is null", async () => {
  const rows = [
    {
      "Adresse Immeuble": "100 Avenue X",
      "Ville": "Montréal",
      "Code Postal Immeuble": "H2Y 1M6",
      "Utilisation prédominante": "Immeuble commercial",
      "Propriétaire": "Gestion Immobilier ABC Inc",
      "Statut aux fins d'imposition scolaire": "Personne morale",
      "Adresse postale": "217 Saint-Jacques, Montréal (Québec) H2Y 1M6",
    },
  ];
  const { plans, stats } = await planPhoneLookups({ rows, openaiClient: null });
  assert.equal(plans[0].strategy, "enrich_owner_postal");
  assert.equal(plans[0].reason, "fallback_deterministic_plan");
  assert.ok(plans[0].plannedQuery);
  // Fallback query: raw name + raw postal street + city + QC + postal + Canada.
  assert.ok(plans[0].plannedQuery.query.includes("Gestion Immobilier ABC Inc"));
  assert.ok(plans[0].plannedQuery.query.includes("217 Saint-Jacques"));
  assert.ok(plans[0].plannedQuery.query.includes("Canada"));
  assert.equal(plans[0].plannedQuery.expectedCivic, "217");
  assert.equal(stats.enrichOwnerPostal, 1);
  assert.equal(stats.gptCallCount, 0);
});

test("planPhoneLookups skips Logement + Personne physique when GPT unavailable", async () => {
  const rows = [
    {
      "Adresse Immeuble": "5000 Rue Principale",
      "Ville": "Longueuil",
      "Code Postal Immeuble": "J4K 1A1",
      "Utilisation prédominante": "Logement",
      "Propriétaire": "Jean Tremblay",
      "Statut aux fins d'imposition scolaire": "Personne physique",
      "Adresse postale": "5000 Rue Principale, Longueuil (Québec) J4K 1A1",
    },
  ];
  const { plans, stats } = await planPhoneLookups({ rows, openaiClient: null });
  assert.equal(plans[0].strategy, "skip_no_lead");
  assert.equal(plans[0].reason, "fallback_logement_personne_physique");
  assert.equal(plans[0].plannedQuery, null);
  assert.equal(stats.skipNoLead, 1);
});

test("planPhoneLookups uses GPT plans when openaiClient is provided (mocked)", async () => {
  // Fake openaiClient that returns exactly one plan per batch.
  const openaiClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  plans: [
                    {
                      rowIdx: 0,
                      strategy: "owner_postal",
                      ownerName: "9440-5222 Québec Inc",
                      ownerNameForQuery: "9440-5222 Québec Inc",
                      ownerPostalClean: "217 Saint-Jacques",
                      reason: "numbered company, residential",
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 123, completion_tokens: 45 },
        }),
      },
    },
  };
  const rows = [
    {
      "Adresse Immeuble": "5000 Rue Principale",
      "Ville": "Longueuil",
      "Code Postal Immeuble": "J4K 1A1",
      "Utilisation prédominante": "Logement",
      "Propriétaire": "9440-5222 Québec Inc",
      "Statut aux fins d'imposition scolaire": "Personne morale",
      "Adresse postale": "800-217 Saint-Jacques, Montréal (Québec) H2Y 1M6",
    },
  ];
  const { plans, stats } = await planPhoneLookups({ rows, openaiClient });
  assert.equal(plans[0].strategy, "enrich_owner_postal");
  assert.equal(plans[0].reason, "numbered company, residential");
  // Query uses the GPT-cleaned postal street.
  assert.ok(plans[0].plannedQuery.query.includes("217 Saint-Jacques"));
  assert.ok(!plans[0].plannedQuery.query.includes("800-217"));
  assert.equal(stats.gptCallCount, 1);
  assert.equal(stats.gptTokensIn, 123);
  assert.equal(stats.gptTokensOut, 45);
  assert.equal(stats.enrichOwnerPostal, 1);
});

test("planPhoneLookups does NOT short-circuit on a building phone alone", async () => {
  // Regression — "Téléphone Immeuble" usually dials a superintendent or tenant,
  // not the owner we want to pitch an acquisition to. A row that has a building
  // phone but NO owner phone must still route through enrichment; the building
  // phone travels along on `buildingPhones` as a weak fallback.
  const rows = [
    {
      "Adresse Immeuble": "5000 Rue Principale",
      "Ville": "Longueuil",
      "Code Postal Immeuble": "J4K 1A1",
      "Utilisation prédominante": "Immeuble commercial",
      "Propriétaire": "Gestion Immobilier ABC Inc",
      "Statut aux fins d'imposition scolaire": "Personne morale",
      "Adresse postale": "217 Saint-Jacques, Montréal (Québec) H2Y 1M6",
      "Téléphone Immeuble": "(450) 555-0111",
    },
  ];
  const { plans, stats } = await planPhoneLookups({ rows, openaiClient: null });
  assert.equal(plans[0].strategy, "enrich_owner_postal");
  assert.equal(plans[0].reason, "fallback_deterministic_plan");
  // Owner phone list stays empty — we did NOT treat the building phone as solved.
  assert.deepEqual(plans[0].filePhones, []);
  // Building phone is preserved on the plan as a fallback contact.
  assert.ok(Array.isArray(plans[0].buildingPhones));
  assert.ok(plans[0].buildingPhones.includes("(450) 555-0111"));
  assert.equal(stats.useFilePhone, 0);
  assert.equal(stats.enrichOwnerPostal, 1);
});

test("planPhoneLookups still uses an owner phone when both phones are present", async () => {
  // A row with BOTH an owner phone and a building phone short-circuits on the
  // owner phone (that's the one we actually want to call), and still carries
  // the building phone along for reference.
  const rows = [
    {
      "Adresse Immeuble": "5000 Rue Principale",
      "Ville": "Longueuil",
      "Code Postal Immeuble": "J4K 1A1",
      "Utilisation prédominante": "Immeuble commercial",
      "Propriétaire": "Gestion Immobilier ABC Inc",
      "Statut aux fins d'imposition scolaire": "Personne morale",
      "Adresse postale": "217 Saint-Jacques, Montréal (Québec) H2Y 1M6",
      "Téléphone": "(514) 555-0199",
      "Téléphone Immeuble": "(450) 555-0111",
    },
  ];
  const { plans, stats } = await planPhoneLookups({ rows, openaiClient: null });
  assert.equal(plans[0].strategy, "use_file_phone");
  assert.ok(plans[0].filePhones.includes("(514) 555-0199"));
  assert.ok(!plans[0].filePhones.includes("(450) 555-0111"));
  assert.ok(plans[0].buildingPhones.includes("(450) 555-0111"));
  assert.equal(stats.useFilePhone, 1);
});

test("planPhoneLookups handles empty input gracefully", async () => {
  const { plans, stats } = await planPhoneLookups({ rows: [], openaiClient: null });
  assert.deepEqual(plans, []);
  assert.equal(stats.total, 0);
  assert.equal(stats.useFilePhone, 0);
  assert.equal(stats.enrichOwnerPostal, 0);
  assert.equal(stats.skipNoLead, 0);
});
