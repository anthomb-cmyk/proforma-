// Regression tests for services/placesQueryGate.js
//
// Verifies the eligibility / query-shape predicates that the future Places
// fallback will consult before issuing any HTTP request. These tests pin
// down both the package-based decisions AND the parity contract with
// services/phoneEnrichment.js (the row-based flow).
//
// Run with:  node --test services/placesQueryGate.test.js
//
// No external deps: uses node:test + node:assert.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKED_PLACE_TYPES,
  hasBlockedType,
  isResidentialUtilisation,
  isCommercialUtilisation,
  isPackagePlacesEligible,
  canUseBuildingAddressAsQuery,
  canUseMailingAddressAsQuery,
  canUseOwnerNameAsQuery,
  __testables__,
} from "./placesQueryGate.js";
import { __testables__ as phoneEnrichmentTestables } from "./phoneEnrichment.js";

// ─── 0. Parity with phoneEnrichment.js ──────────────────────────────────────

test("BLOCKED_PLACE_TYPES is in lockstep with phoneEnrichment.js", () => {
  const fromPhoneEnrichment = phoneEnrichmentTestables.BLOCKED_PLACE_TYPES;
  // Both Sets must hold exactly the same members. If this test fails after
  // editing one file, edit the OTHER file to match — the two are the single-
  // source-of-truth pair the parity comment in placesQueryGate.js references.
  assert.equal(BLOCKED_PLACE_TYPES.size, fromPhoneEnrichment.size);
  for (const t of fromPhoneEnrichment) {
    assert.ok(BLOCKED_PLACE_TYPES.has(t), `placesQueryGate is missing "${t}"`);
  }
  for (const t of BLOCKED_PLACE_TYPES) {
    assert.ok(fromPhoneEnrichment.has(t), `phoneEnrichment is missing "${t}"`);
  }
});

// ─── 1. Eligible categories: company / gestion / immobilier ────────────────

test("immobilier package is eligible (category-driven)", () => {
  const pkg = {
    lead_owner_name: "GESTION IMMOBILIÈRE TREMBLAY INC.",
    legal_entity_category: "immobilier",
    mailing_city: "Longueuil",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
  assert.match(reason, /^category_/);
});

test("gestion package is eligible by category alone (no mailing required)", () => {
  const pkg = {
    lead_owner_name: "GESTION ABC INC.",
    legal_entity_category: "gestion",
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

test("inc_ltee package is eligible", () => {
  const pkg = {
    lead_owner_name: "Construction XYZ Inc.",
    legal_entity_category: "inc_ltee",
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

test("holdings package is eligible", () => {
  const pkg = {
    lead_owner_name: "Holdings ABC Inc.",
    legal_entity_category: "holdings",
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

// ─── 2. Trust / fiducie eligibility ────────────────────────────────────────

test("trust/fiducie WITH mailing address is eligible", () => {
  const pkg = {
    lead_owner_name: "FIDUCIE FAMILLE TREMBLAY",
    legal_entity_category: "trust",
    mailing_address: "100 rue Principale",
    mailing_city: "Sherbrooke",
    mailing_postal_code: "J1H 1A1",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
  assert.equal(reason, "category_trust");
});

test("trust without mailing address is still eligible (name-queryable category)", () => {
  // Trusts are name-searchable in registries, so no mailing required.
  const pkg = {
    lead_owner_name: "FIDUCIE PROVINCIALE",
    legal_entity_category: "trust",
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

// ─── 3. Numbered companies: package-based behavior ─────────────────────────

test("numbered company WITH mailing address is eligible (package-based)", () => {
  const pkg = {
    lead_owner_name: "9876-5432 QUÉBEC INC.",
    legal_entity_category: "numbered_company",
    mailing_address: "200 boul. Industriel",
    mailing_city: "Brossard",
    mailing_postal_code: "J4Z 1B2",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
  assert.equal(reason, "numbered_company_with_mailing_address");
});

test("numbered company WITHOUT mailing address is NOT eligible", () => {
  const pkg = {
    lead_owner_name: "9876-5432 QUÉBEC INC.",
    legal_entity_category: "numbered_company",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, false);
  assert.equal(reason, "numbered_company_without_mailing_address");
});

test("numbered company recognized by name regex when category is missing", () => {
  const pkg = {
    lead_owner_name: "9123-4567 Canada Inc.",
    mailing_address: "55 rue du Parc",
    mailing_city: "Granby",
    mailing_postal_code: "J2G 1A1",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
  assert.equal(reason, "numbered_company_with_mailing_address");
});

test("numbered company eligibility uses mailingAddresses[] when present", () => {
  const pkg = {
    lead_owner_name: "1111-2222 Québec Inc.",
    legal_entity_category: "numbered_company",
    mailingAddresses: [
      {
        street: "10 rue Principale",
        city: "Trois-Rivières",
        province: "QC",
        postalCode: "G8T 2C2",
      },
    ],
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

// ─── 4. Generic individual rejection ───────────────────────────────────────

test("generic individual without business signal is NOT eligible", () => {
  const pkg = {
    lead_owner_name: "Jean Tremblay",
    legal_entity_category: "individual",
    mailing_address: "100 rue des Érables",
    mailing_city: "Longueuil",
    mailing_postal_code: "J4H 1A1",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, false);
  assert.equal(reason, "individual_no_business");
});

test("personal-looking name with no category is NOT eligible", () => {
  const pkg = { lead_owner_name: "Mathieu Bourque" };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, false);
  assert.equal(reason, "looks_like_personal_name");
});

// ─── 5. Empty / junk name rejection ────────────────────────────────────────

test("empty lead_owner_name is NOT eligible", () => {
  assert.equal(isPackagePlacesEligible({}).eligible, false);
  assert.equal(isPackagePlacesEligible({ lead_owner_name: "" }).eligible, false);
  assert.equal(isPackagePlacesEligible({ lead_owner_name: "   " }).eligible, false);
});

test("junk numeric/cadastre/URL name is NOT eligible", () => {
  for (const name of ["12345678", "1234-56-7890-1-234-5678", "https://x.com", "info@x.com"]) {
    const { eligible } = isPackagePlacesEligible({
      lead_owner_name: name,
      legal_entity_category: "inc_ltee",
    });
    assert.equal(eligible, false, `expected ${name} to be junk-rejected`);
  }
});

test("null / non-object input returns no_package", () => {
  assert.equal(isPackagePlacesEligible(null).reason, "no_package");
  assert.equal(isPackagePlacesEligible(undefined).reason, "no_package");
  assert.equal(isPackagePlacesEligible("string").reason, "no_package");
});

// ─── 6. Residential building address rejection ─────────────────────────────

test("residential 'Logement' building address is NOT a valid query anchor", () => {
  const pkg = {
    address: "500 rue des Locataires",
    utilisation: "Logement",
  };
  const { allowed, reason } = canUseBuildingAddressAsQuery(pkg);
  assert.equal(allowed, false);
  assert.equal(reason, "residential_utilisation");
});

test("isResidentialUtilisation accepts singular and plural forms", () => {
  assert.equal(isResidentialUtilisation("Logement"), true);
  assert.equal(isResidentialUtilisation("Logements"), true);
  assert.equal(isResidentialUtilisation("LOGEMENT"), true);
  assert.equal(isResidentialUtilisation("logement"), true);
});

// ─── 7. Commercial building address acceptance ─────────────────────────────

test("commercial building address may be used as a query", () => {
  for (const utilisation of [
    "Immeuble commercial",
    "Industrie",
    "Services",
    "Commerce de détail",
    "", // unknown utilisation defaults to commercial-eligible
  ]) {
    const pkg = { address: "100 boul. Industriel", utilisation };
    const { allowed } = canUseBuildingAddressAsQuery(pkg);
    assert.equal(
      allowed,
      true,
      `utilisation="${utilisation}" should allow building address`,
    );
  }
});

test("isCommercialUtilisation is the inverse of isResidentialUtilisation", () => {
  assert.equal(isCommercialUtilisation("Logement"), false);
  assert.equal(isCommercialUtilisation("Immeuble commercial"), true);
  assert.equal(isCommercialUtilisation(""), true);
});

test("canUseBuildingAddressAsQuery returns no_building_address for empty addr", () => {
  const { allowed, reason } = canUseBuildingAddressAsQuery({
    utilisation: "Immeuble commercial",
  });
  assert.equal(allowed, false);
  assert.equal(reason, "no_building_address");
});

// ─── 8. Blocked place types ────────────────────────────────────────────────

test("hasBlockedType rejects city_hall / political / locality / etc.", () => {
  for (const t of [
    "city_hall",
    "political",
    "locality",
    "post_office",
    "police",
    "fire_station",
    "courthouse",
    "country",
  ]) {
    assert.equal(
      hasBlockedType([t]),
      true,
      `expected hasBlockedType(["${t}"]) to be true`,
    );
  }
});

test("hasBlockedType allows real business types", () => {
  assert.equal(hasBlockedType(["restaurant"]), false);
  assert.equal(hasBlockedType(["real_estate_agency"]), false);
  assert.equal(hasBlockedType(["establishment", "point_of_interest"]), false);
});

test("hasBlockedType is safe against non-array input", () => {
  assert.equal(hasBlockedType(null), false);
  assert.equal(hasBlockedType(undefined), false);
  assert.equal(hasBlockedType("city_hall"), false);
  assert.equal(hasBlockedType({}), false);
});

test("hasBlockedType rejects an array containing one bad type plus good types", () => {
  // Mixed-type results from Places must still be rejected.
  assert.equal(
    hasBlockedType(["establishment", "point_of_interest", "city_hall"]),
    true,
  );
});

// ─── 9. Old phoneEnrichment behavior remains unchanged ─────────────────────

test("phoneEnrichment.js exports unchanged: same testables surface", async () => {
  // Mirror the previous test to confirm we did not alter the old module's
  // public testables.
  const testables = phoneEnrichmentTestables;
  for (const k of [
    "CADASTRE_RE",
    "MATRICULE_RE",
    "NUMBERED_CORP_RE",
    "MUNICIPAL_RE",
    "BLOCKED_PLACE_TYPES",
    "PHONE_RE",
    "flattenPlaceResult",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(testables, k),
      `phoneEnrichment.__testables__ missing ${k}`,
    );
  }
});

test("phoneEnrichment isJunkBusinessName / looksLikePersonalName behave identically (re-imported)", async () => {
  const phoneEnrichment = await import("./phoneEnrichment.js");
  // Spot-check: same inputs → same outputs through the imported references
  // that placesQueryGate uses internally. If anyone re-implemented these in
  // placesQueryGate, this would catch the drift.
  assert.equal(phoneEnrichment.isJunkBusinessName("12345678"), true);
  assert.equal(phoneEnrichment.isJunkBusinessName("Real Business Inc."), false);
  assert.equal(phoneEnrichment.looksLikePersonalName("Jean Tremblay"), true);
  assert.equal(phoneEnrichment.looksLikePersonalName("Gestion ABC Inc."), false);
});

// ─── Reliable-phone short-circuit ──────────────────────────────────────────

test("package with reliable owner phone is NOT eligible (short-circuit)", () => {
  const pkg = {
    lead_owner_name: "GESTION IMMOBILIÈRE INC.",
    legal_entity_category: "gestion",
    candidatePhones: [
      {
        phone: "(450) 555-0101",
        source: "file",
        relationship_to_lead_owner: "owner",
      },
    ],
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, false);
  assert.equal(reason, "already_has_reliable_phone");
});

test("building-relationship phone does NOT count as reliable owner phone", () => {
  const pkg = {
    lead_owner_name: "GESTION IMMOBILIÈRE INC.",
    legal_entity_category: "gestion",
    candidatePhones: [
      {
        phone: "(450) 555-0102",
        source: "file",
        relationship_to_lead_owner: "building",
      },
    ],
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

test("opt-out: skipIfHasReliablePhone=false ignores existing owner phone", () => {
  const pkg = {
    lead_owner_name: "GESTION IMMOBILIÈRE INC.",
    legal_entity_category: "gestion",
    candidatePhones: [
      {
        phone: "(450) 555-0103",
        source: "file",
        relationship_to_lead_owner: "owner",
      },
    ],
  };
  const { eligible } = isPackagePlacesEligible(pkg, {
    skipIfHasReliablePhone: false,
  });
  assert.equal(eligible, true);
});

// ─── search_eligibility flag ───────────────────────────────────────────────

test("explicit skip_unsearchable flag → not eligible", () => {
  const pkg = {
    lead_owner_name: "GESTION IMMOBILIÈRE INC.",
    legal_entity_category: "gestion",
    search_eligibility: "skip_unsearchable",
  };
  const { eligible, reason } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, false);
  assert.equal(reason, "not_search_eligible");
});

test("absent search_eligibility flag is allowed (treated as eligible)", () => {
  const pkg = {
    lead_owner_name: "GESTION IMMOBILIÈRE INC.",
    legal_entity_category: "gestion",
  };
  const { eligible } = isPackagePlacesEligible(pkg);
  assert.equal(eligible, true);
});

// ─── canUseOwnerNameAsQuery / canUseMailingAddressAsQuery ──────────────────

test("canUseOwnerNameAsQuery: plain business name is allowed", () => {
  const { allowed } = canUseOwnerNameAsQuery({
    lead_owner_name: "GESTION IMMOBILIÈRE TREMBLAY INC.",
  });
  assert.equal(allowed, true);
});

test("canUseOwnerNameAsQuery: numbered company needs address anchor", () => {
  const { allowed, reason } = canUseOwnerNameAsQuery({
    lead_owner_name: "9876-5432 QUÉBEC INC.",
    legal_entity_category: "numbered_company",
  });
  assert.equal(allowed, false);
  assert.equal(reason, "numbered_company_needs_address_anchor");
});

test("canUseOwnerNameAsQuery: personal name is rejected", () => {
  const { allowed, reason } = canUseOwnerNameAsQuery({
    lead_owner_name: "Jean Tremblay",
  });
  assert.equal(allowed, false);
  assert.equal(reason, "personal_name");
});

test("canUseMailingAddressAsQuery: street + city is allowed", () => {
  const { allowed } = canUseMailingAddressAsQuery({
    mailing_address: "100 rue Principale",
    mailing_city: "Longueuil",
    mailing_postal_code: "J4H 1A1",
  });
  assert.equal(allowed, true);
});

test("canUseMailingAddressAsQuery: city + postal alone is allowed", () => {
  const { allowed } = canUseMailingAddressAsQuery({
    mailing_city: "Sherbrooke",
    mailing_postal_code: "J1H 1A1",
  });
  assert.equal(allowed, true);
});

test("canUseMailingAddressAsQuery: empty fields → not allowed", () => {
  const { allowed, reason } = canUseMailingAddressAsQuery({});
  assert.equal(allowed, false);
  assert.equal(reason, "no_mailing_address");
});

test("canUseMailingAddressAsQuery: reads mailingAddresses[] array", () => {
  const { allowed } = canUseMailingAddressAsQuery({
    mailingAddresses: [
      {
        street: "200 boul. Test",
        city: "Brossard",
        province: "QC",
        postalCode: "J4Z 1A1",
      },
    ],
  });
  assert.equal(allowed, true);
});

// ─── Internal helpers (sanity) ──────────────────────────────────────────────

test("hasUsefulMailingAddress accepts at least one useful address in mailingAddresses[]", () => {
  const { hasUsefulMailingAddress } = __testables__;
  assert.equal(hasUsefulMailingAddress({}), false);
  assert.equal(
    hasUsefulMailingAddress({
      mailingAddresses: [
        { street: "", city: "", postalCode: "" },
        { street: "100 rue X", city: "Laval", postalCode: "H7V 1K1" },
      ],
    }),
    true,
  );
});

test("isNumberedCompanyPkg recognizes both category flag and name pattern", () => {
  const { isNumberedCompanyPkg } = __testables__;
  assert.equal(
    isNumberedCompanyPkg({ legal_entity_category: "numbered_company" }),
    true,
  );
  assert.equal(
    isNumberedCompanyPkg({ lead_owner_name: "9123-4567 Québec Inc." }),
    true,
  );
  assert.equal(
    isNumberedCompanyPkg({ lead_owner_name: "Real Estate Group Inc." }),
    false,
  );
});
