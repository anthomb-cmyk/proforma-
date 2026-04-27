// End-to-end smoke test for the contact-candidate flow. Walks one row from
// raw Excel through:
//   1. Pre-existing CRM state (an Owner with a file phone+email from an
//      earlier import).
//   2. New rôle XLSX row with owner phone, building phone, owner email,
//      building email, and an owner website.
//   3. mergeOwners() (re-import)
//   4. applyLookupResultsToOwners() (Google Places enrichment adds a new
//      phone + website).
//
// Asserts every invariant on the review checklist:
//   • all file contacts preserved (existing + new)
//   • existing contacts preserved (no overwrite)
//   • online contacts appended
//   • no duplicates (same phone+source+source_column collapses)
//   • source_column preserved for file contacts
//   • owner-level vs building-level relationship preserved
//   • primary phone/email/website still populated for backward compatibility

import {
  makePhoneCandidate,
  makeEmailCandidate,
} from "./contactCandidates.js";
import { extractRoleData, buildOwnersAndLeadsFromRole } from "./roleImport.js";
import { applyLookupResultsToOwners } from "./ownerGrouping.js";
import { normalizePhoneKey } from "./phoneUtils.js";

describe("smoke: file → re-import merge → online enrichment", () => {
  test("preserves existing + new file contacts and appends online ones with full attribution", () => {
    // ─── 1. Pre-existing CRM state ─────────────────────────────────────────
    // Same owner — keyed by mailing-postal — already has one file phone +
    // one file email from an earlier import. The user has also progressed
    // the lead's stage, which mergeOwners must preserve.
    const existingFilePhone = makePhoneCandidate({
      phone: "(450) 555-0142",
      source: "file",
      source_column: "Téléphone Propriétaire (premier import)",
      phone_owner_name: "Jean Tremblay",
      relationship_to_lead_owner: "owner",
      evidence: "first import 2026-01",
    });
    const existingFileEmail = makeEmailCandidate({
      email: "old@tremblay.com",
      source: "file",
      source_column: "Courriel (premier import)",
      email_owner_name: "Jean Tremblay",
      relationship_to_lead_owner: "owner",
      evidence: "first import 2026-01",
    });
    const existingOwners = [{
      id: "owner_existing",
      ownerKey: "217 saint jacques|h2y1m6",
      displayName: "Jean Tremblay",
      postalAddress: { street: "217 Saint-Jacques", city: "Montréal", province: "QC", postalCode: "H2Y 1M6" },
      aliases: [],
      contactNames: ["Jean Tremblay"],
      phones: ["(450) 555-0142"],
      phoneSources: { "4505550142": "Excel" },
      emails: ["old@tremblay.com"],
      websites: [],
      candidatePhones: [existingFilePhone],
      candidateEmails: [existingFileEmail],
      candidateWebsites: [],
      buildings: [{ id: "b0", address: "50 Pre-existing", postalCode: "H1Z 1Z1" }],
      stage: "contacted",
      callStatus: "tried",
      callNotes: "Laissé VM mardi",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: 1700000000000,
      lookupStatus: "pending",
    }];

    // ─── 2. New rôle XLSX row with five contact columns ────────────────────
    const headers = [
      "Adresse Immeuble", "Numéro de matricule",
      "Propriétaire", "Statut aux fins d'imposition scolaire",
      "Adresse postale",
      "Téléphone", "Téléphone Immeuble",
      "Courriel", "Courriel Immeuble",
      "Site web",
    ];
    const rows = [{
      "Adresse Immeuble": "100 Elm",
      "Numéro de matricule": "M1",
      "Propriétaire": "Jean Tremblay",
      "Statut aux fins d'imposition scolaire": "Personne physique",
      // SAME mailing postal as existingOwners → grouped into the same Owner.
      "Adresse postale": "217 rue Saint-Jacques, Montréal (Québec) H2Y 1M6",
      "Téléphone": "514-555-0142",
      "Téléphone Immeuble": "438-555-0143",
      "Courriel": "jean@tremblay.com",
      "Courriel Immeuble": "concierge@immeuble.com",
      "Site web": "https://tremblay.com",
    }];

    // ─── 3. Re-import: extract + mergeOwners via buildOwnersAndLeadsFromRole.
    const parsed = extractRoleData({ headers, rows });
    const { allOwners, leads } = buildOwnersAndLeadsFromRole(parsed, existingOwners, {
      sourceFile: "second-import.xlsx",
    });
    const owner = allOwners.find((o) => o.ownerKey === existingOwners[0].ownerKey);
    expect(owner).toBeTruthy();

    // User-curated state preserved through merge.
    expect(owner.stage).toBe("contacted");
    expect(owner.callNotes).toBe("Laissé VM mardi");

    // ── all file contacts preserved (existing + new), source_column intact ──
    const ownerPhoneCols = owner.candidatePhones.map((c) => c.source_column).sort();
    expect(ownerPhoneCols).toEqual([
      "Téléphone",
      "Téléphone Immeuble",
      "Téléphone Propriétaire (premier import)",
    ]);
    const ownerEmailCols = owner.candidateEmails.map((c) => c.source_column).sort();
    expect(ownerEmailCols).toEqual([
      "Courriel",
      "Courriel (premier import)",
      "Courriel Immeuble",
    ]);
    expect(owner.candidateWebsites.map((c) => c.source_column)).toEqual(["Site web"]);

    // ── owner-level vs building-level relationship preserved ──
    const phoneRels = Object.fromEntries(
      owner.candidatePhones.map((c) => [c.source_column, c.relationship_to_lead_owner])
    );
    expect(phoneRels["Téléphone"]).toBe("owner");
    expect(phoneRels["Téléphone Immeuble"]).toBe("building");
    expect(phoneRels["Téléphone Propriétaire (premier import)"]).toBe("owner");
    const emailRels = Object.fromEntries(
      owner.candidateEmails.map((c) => [c.source_column, c.relationship_to_lead_owner])
    );
    expect(emailRels["Courriel"]).toBe("owner");
    expect(emailRels["Courriel Immeuble"]).toBe("building");
    expect(emailRels["Courriel (premier import)"]).toBe("owner");

    // ── primary fields populated for the lead generated from this property ──
    const lead = leads.find((l) => l.ownerIds?.includes(owner.id));
    expect(lead).toBeTruthy();
    expect(lead.phone).toBe("(514) 555-0142");
    expect(lead.email).toBe("jean@tremblay.com");
    expect(lead.website).toBe("tremblay.com");
    // Flat arrays carry every distinct value.
    expect(lead.phones).toEqual(expect.arrayContaining(["(514) 555-0142", "(438) 555-0143"]));
    expect(lead.emails).toEqual(expect.arrayContaining(["jean@tremblay.com", "concierge@immeuble.com"]));
    expect(lead.websites).toEqual(["tremblay.com"]);

    // ─── 4. Online enrichment: applyLookupResultsToOwners adds another ────
    //     phone + website (Google Places). File candidates must survive.
    const rowLookup = [{ row: {}, ownerId: owner.id, ownerKey: owner.ownerKey }];
    const results = [{
      phone: "514-555-0146",
      status: "found",
      candidates: [],
      source: "google_places",
      matchedName: "Tremblay Investments",
      confidence: 80,
      website: "https://tremblay-investments.com",
    }];
    const { owners: enriched } = applyLookupResultsToOwners(allOwners, results, rowLookup);
    const o = enriched.find((x) => x.id === owner.id);

    // ── all three file phones still there with source_column intact ──
    const fileCs = o.candidatePhones.filter((c) => c.source === "file");
    expect(fileCs.map((c) => c.source_column).sort()).toEqual([
      "Téléphone",
      "Téléphone Immeuble",
      "Téléphone Propriétaire (premier import)",
    ]);
    // ── online phone appended (not overwriting) ──
    const onlineP = o.candidatePhones.find((c) => c.source === "google_places");
    expect(onlineP).toBeTruthy();
    expect(onlineP.phone).toBe("(514) 555-0146");
    // Total = 3 file + 1 online with no dupes.
    expect(o.candidatePhones).toHaveLength(4);

    // ── online website appended; file website preserved ──
    const fileW = o.candidateWebsites.find((c) => c.source === "file");
    const onlineW = o.candidateWebsites.find((c) => c.source === "google_places");
    expect(fileW.website).toBe("tremblay.com");
    expect(fileW.source_column).toBe("Site web");
    expect(onlineW.website).toBe("tremblay-investments.com");

    // ── owner.phones[] (legacy backward-compat field) carries the existing
    //     pre-import phone, the new owner-relationship file phone, and the
    //     online phone, deduped by normalized key. Building phones only live
    //     in candidatePhones — that's intentional and matches the pre-change
    //     contract for Owner records (building phones never went into
    //     owner.phones in the rôle flow).
    const ownerPhoneKeys = o.phones.map(normalizePhoneKey).sort();
    expect(ownerPhoneKeys).toEqual([
      "4505550142", // existing
      "5145550142", // new file owner phone
      "5145550146", // online (Places)
    ]);
    // No duplicates in the deduped phones array.
    expect(new Set(ownerPhoneKeys).size).toBe(ownerPhoneKeys.length);

    // The lead emitted from this re-import (before applyLookupResultsToOwners)
    // already exposes the building phone in its flat phones[] (lead.phones is
    // the union of owner + building file candidates).
    const leadPhoneKeys = lead.phones.map(normalizePhoneKey).sort();
    expect(leadPhoneKeys).toEqual(["4385550143", "5145550142"]);
  });
});
