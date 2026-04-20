// proforma-web/src/lib/ownerGrouping.js
//
// Group CSV/XLSX rows (and legacy building-level leads) into Owner records.
// An Owner is the physical investor behind any number of numbered companies
// that share a mailing address. See lib/ownerKey.js for the identity rule.
//
// Public API:
//   extractOwnerInfo(rawRow)        — finds owner name/address/postal from Quebec-roll columns
//   deriveOwnerKey(rowOrLead)       — returns the canonical ownerKey for a row or lead
//   groupRowsByOwner(preparedRows)  — aggregates freshly-imported rows into Owners
//   migrateLeadsToOwners(leads)     — one-time migration of existing building-level leads
//   mergeOwners(existing, incoming) — upsert helper: keeps existing CRM state, adds new buildings/aliases
//
// Owner shape:
//   {
//     id: "owner_<ownerKey-hash>",
//     ownerKey,                       // canonical grouping key (see ownerKey.js)
//     displayName,                    // most common Propriétaire personal name
//     postalAddress: { street, city, province, postalCode },
//     aliases: [string],              // every distinct company name seen for this owner
//     contactNames: [string],         // natural-person names (spouses etc.) sharing the address
//     phones: [string],               // deduped, ordered
//     phoneSources: { [normalizedPhoneKey]: "Excel" | "Places" | "Manual" | "Migrated" },
//     matchedBusinessName,            // last Places business-name hit (for disclosure in the UI)
//     emails: [string],
//     buildings: [{
//       id, address, city, province, postalCode, buildingAddress,
//       units, utilisation, assessment, yearBuilt, lotArea, sourceFile, sourceRow,
//       lat, lon, matricule, yearRegistered, valeurImmeuble, valeurTerrain, valeurBatiment,
//     }],
//     stage, callStatus, callNotes, lastCallAt, nextCallAt,
//     createdAt, updatedAt,
//     lookupStatus,                   // "pending" | "found" | "not_found"
//     notes,
//   }
//
// phoneSources (new in the rôle-import flow): tags each phone with where it
// came from. Unknown/absent source is treated as "Migrated" by the UI.
// Keys are normalizePhoneKey(phone) so re-formatting ("514.555.1111" vs.
// "(514) 555-1111") still resolves to the same source entry.

import { ownerKey as buildOwnerKey, normalizeStreet, normalizePostal } from "./ownerKey.js";
import { normalizePhoneKey } from "./phoneUtils.js";

// Column-pattern probes (mirrors services/phoneEnrichment.js HEADER_PATTERNS).
// Keep keys lowercased + accent-stripped before testing.
const OWNER_NAME_PATTERNS = [
  /\bproprietaire\d*\s*_?\s*nom\b/,
  /\bproprietaire\s+nom\b/,
  /\bowner\s+name\b/,
  /\bnom\s+proprio\b/,
];
const OWNER_ADDRESS_PATTERNS = [
  /\bproprietaire\d*\s*_?\s*adresse(?:\s*_?\s*clean)?\b/,
  /\bproprietaire\s+adresse\b/,
  /\bowner\s+address\b/,
  /\badresse\s+postale\b/,
];
const OWNER_POSTAL_PATTERNS = [
  /\bproprietaire\d*\s*_?\s*code\s*_?\s*postal\b/,
  /\bproprietaire\d*\s*_?\s*cp\b/,
  /\bowner\s+postal\b/,
  /\bcp\s+proprietaire\b/,
];
const OWNER_CITY_PATTERNS = [
  /\bproprietaire\d*\s*_?\s*ville\b/,
  /\bproprietaire\d*\s*_?\s*municipalite\b/,
  /\bowner\s+city\b/,
];
const OWNER_PROVINCE_PATTERNS = [
  /\bproprietaire\d*\s*_?\s*province\b/,
  /\bowner\s+province\b/,
];

// Strip accents + lowercase a column header so our regexes can match against
// a normalized form regardless of how the CSV capitalized things.
function normalizeHeaderKey(key) {
  return String(key || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Walk a row's keys once and return the first value whose normalized key
// matches ANY of the given patterns. Patterns are ordered by priority.
function firstMatchingValue(rawRow, patterns) {
  if (!rawRow || typeof rawRow !== "object") return "";
  const pairs = Object.entries(rawRow);
  for (const rx of patterns) {
    for (const [k, v] of pairs) {
      if (!v) continue;
      if (rx.test(normalizeHeaderKey(k))) {
        const s = String(v).trim();
        if (s) return s;
      }
    }
  }
  return "";
}

// Extract the best-guess owner identity from a raw CSV row. Returns empty
// strings when the CSV doesn't expose owner-postal-address columns, in which
// case deriveOwnerKey falls back to the building address (still better than
// grouping by company name, because building-address dedup catches personal
// residences that share a mailing address with no numbered-company layer).
export function extractOwnerInfo(rawRow) {
  const name = firstMatchingValue(rawRow, OWNER_NAME_PATTERNS);
  const address = firstMatchingValue(rawRow, OWNER_ADDRESS_PATTERNS);
  const postalCode = firstMatchingValue(rawRow, OWNER_POSTAL_PATTERNS);
  const city = firstMatchingValue(rawRow, OWNER_CITY_PATTERNS);
  const province = firstMatchingValue(rawRow, OWNER_PROVINCE_PATTERNS);
  return { name, address, city, province, postalCode };
}

// Derive the grouping key for a prepared import row. Priority:
//   1. Explicit owner mailing address + owner postal (strongest — exact ask
//      from the business-logic spec).
//   2. Building address + building postal (fallback — if the owner lives in
//      the building, these coincide; if not, this still dedupes per-building
//      and doesn't group across different investors).
//   3. Empty key — caller treats the row as its own singleton.
export function deriveOwnerKey(row) {
  if (!row) return "";
  const owner = extractOwnerInfo(row.rawRow);
  if (owner.address || owner.postalCode) {
    const k = buildOwnerKey(owner.address, owner.postalCode);
    if (k && k !== "|") return k;
  }
  // Fall back to building address; many rural rolls have only building data.
  const street = row.address || row.buildingAddress || "";
  const postal = row.postalCode || "";
  const k = buildOwnerKey(street, postal);
  if (k && k !== "|") return k;
  return "";
}

// For legacy leads (no rawRow preserved in every case), derive a key from the
// fields we DO have. This is lossier than fresh imports because legacy leads
// typically have only the building address, not the owner's mailing address —
// meaning two different investors who each own one building in the same block
// would NOT be wrongly merged, but a single investor with 58 buildings WILL
// still appear as 58 separate "owners" until the user re-imports the source CSV.
// That's acceptable: migration is best-effort and the primary benefit is model
// unification, not perfect dedup of pre-existing data.
export function deriveOwnerKeyForLead(lead) {
  if (!lead) return "";
  // If we happen to have preserved rawRow, use the richer extraction.
  if (lead.rawRow) {
    const owner = extractOwnerInfo(lead.rawRow);
    if (owner.address || owner.postalCode) {
      const k = buildOwnerKey(owner.address, owner.postalCode);
      if (k && k !== "|") return k;
    }
  }
  const street = lead.address || lead.buildingAddress || "";
  const postal = lead.postalCode || "";
  const k = buildOwnerKey(street, postal);
  if (k && k !== "|") return k;
  return "";
}

// Pick the most frequent non-empty string from an array of values. Ties
// broken by first-occurrence — this gives us a stable displayName across
// re-runs. An empty input yields "".
function mostCommon(values) {
  const counts = new Map();
  const order = [];
  for (const v of values) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (!counts.has(s)) {
      counts.set(s, 0);
      order.push(s);
    }
    counts.set(s, counts.get(s) + 1);
  }
  if (!order.length) return "";
  let best = order[0];
  let bestN = counts.get(best);
  for (const s of order) {
    const n = counts.get(s);
    if (n > bestN) { best = s; bestN = n; }
  }
  return best;
}

// Deduplicate a phone-list while preserving order + original formatting for
// the first occurrence. We try NANP normalization first (best — collapses
// "514-555-1111" and "(514) 555-1111" to the same key), then fall back to
// a digits-only comparison so test/fake numbers that fail strict NANP
// validation still dedupe by their digit content.
function dedupPhones(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const nanp = normalizePhoneKey(s);
    const digits = s.replace(/\D+/g, "");
    const key = nanp || (digits ? `d:${digits}` : s.toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function dedupStrings(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Generate a stable Owner id from its key. We hash only for brevity; the
// full key lives in .ownerKey and is authoritative for equality checks.
function ownerIdFromKey(key) {
  // Simple djb2-ish to keep the id compact + readable in the URL/UI.
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `owner_${h.toString(36)}`;
}

function nowIso() { return new Date().toISOString(); }

function buildingFromRow(row) {
  return {
    id: `bld_${Math.random().toString(36).slice(2, 9)}`,
    address: row.address || "",
    city: row.city || "",
    province: row.province || "",
    postalCode: row.postalCode || "",
    buildingAddress: row.buildingAddress || "",
    units: row.units || 0,
    utilisation: row.utilisation || "",
    assessment: row.assessment || "",
    yearBuilt: row.yearBuilt || "",
    lotArea: row.lotArea || "",
    sourceFile: row.sourceFile || "",
    // rawRow is intentionally omitted from the persisted building to keep
    // localStorage small. The enrichment payload can be reconstructed from
    // the owner's postalAddress + the building's civic address + aliases.
  };
}

function buildingFromLead(lead) {
  return {
    id: lead?.buildingId || `bld_${Math.random().toString(36).slice(2, 9)}`,
    address: lead?.address || "",
    city: lead?.city || "",
    province: lead?.province || "",
    postalCode: lead?.postalCode || "",
    buildingAddress: lead?.buildingAddress || "",
    units: lead?.units || 0,
    utilisation: lead?.utilisation || "",
    assessment: lead?.assessment || "",
    yearBuilt: lead?.yearBuilt || "",
    lotArea: lead?.lotArea || "",
    sourceFile: lead?.sourceFile || "",
  };
}

// Given a freshly-deduped phone list and a phoneSources mapping fragment,
// attach the `Migrated` tag to any phone that doesn't already have a source
// recorded. Used by groupRowsByOwner (pre-existing CSV data is "Migrated"
// from the rôle-import era perspective) and migrateLeadsToOwners.
function tagPhoneSources(phones, existing, defaultSource) {
  const out = { ...(existing || {}) };
  for (const p of phones) {
    const k = normalizePhoneKey(p);
    if (!k) continue;
    if (!out[k]) out[k] = defaultSource;
  }
  return out;
}

// Group freshly-imported rows (shape: the `prepared` items in LeadsManager
// importLeads()) by owner key and roll them up. Returns Array<Owner>.
export function groupRowsByOwner(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const byKey = new Map();
  for (const row of rows) {
    const key = deriveOwnerKey(row);
    if (!key) continue; // row is too sparse to group — skipped by importer
    const info = extractOwnerInfo(row.rawRow);
    if (!byKey.has(key)) {
      const postalStreet = info.address || row.address || "";
      const postalCity = info.city || row.city || "";
      const postalProvince = info.province || row.province || "";
      const postalCodeRaw = info.postalCode || row.postalCode || "";
      byKey.set(key, {
        id: ownerIdFromKey(key),
        ownerKey: key,
        _contactNames: [],
        _companyNames: [],
        _phones: [],
        _emails: [],
        buildings: [],
        postalAddress: {
          street: postalStreet,
          city: postalCity,
          province: postalProvince,
          postalCode: postalCodeRaw,
        },
        stage: "new",
        callStatus: "none",
        callNotes: "",
        lastCallAt: "",
        nextCallAt: "",
        notes: "",
        createdAt: nowIso(),
        updatedAt: Date.now(),
        lookupStatus: "pending",
      });
    }
    const owner = byKey.get(key);
    if (info.name) owner._contactNames.push(info.name);
    if (row.contactName) owner._contactNames.push(row.contactName);
    if (row.companyName) owner._companyNames.push(row.companyName);
    if (row.email) owner._emails.push(row.email);
    for (const p of (row.inputPhones || [])) owner._phones.push(p);
    if (row.phone) owner._phones.push(row.phone);
    owner.buildings.push(buildingFromRow(row));
    if (row.notes) owner.notes = owner.notes ? `${owner.notes}\n${row.notes}` : row.notes;
  }
  const out = [];
  for (const owner of byKey.values()) {
    const phones = dedupPhones(owner._phones);
    // Legacy CSV imports predate the phoneSources convention; tag them
    // `Migrated` so the UI can distinguish them from fresh Excel/Places hits.
    const phoneSources = tagPhoneSources(phones, {}, "Migrated");
    const finalized = {
      ...owner,
      displayName: mostCommon(owner._contactNames) || mostCommon(owner._companyNames) || "(Propriétaire inconnu)",
      aliases: dedupStrings(owner._companyNames),
      contactNames: dedupStrings(owner._contactNames),
      phones,
      phoneSources,
      emails: dedupStrings(owner._emails),
    };
    delete finalized._contactNames;
    delete finalized._companyNames;
    delete finalized._phones;
    delete finalized._emails;
    out.push(finalized);
  }
  return out;
}

// One-time migration: convert a list of legacy building-level leads into
// Owner records. Preserves call notes, stage, and timestamps by taking the
// most advanced state across all leads in a group (e.g. if any lead was
// "contacted" the whole group becomes "contacted"). Best-effort; accepts
// that lossy grouping is still a strict improvement over dozens of dupes.
const STAGE_RANK = { new: 0, to_call: 1, contacted: 2, qualified: 3, converted: 4, lost: -1 };

function pickBestStage(stages) {
  let best = "new";
  let bestRank = 0;
  for (const s of stages) {
    const r = STAGE_RANK[s];
    if (r == null) continue;
    if (r > bestRank) { best = s; bestRank = r; }
  }
  return best;
}

export function migrateLeadsToOwners(leads) {
  if (!Array.isArray(leads) || !leads.length) return [];
  const byKey = new Map();
  for (const lead of leads) {
    const key = deriveOwnerKeyForLead(lead);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: ownerIdFromKey(key),
        ownerKey: key,
        _contactNames: [],
        _companyNames: [],
        _phones: [],
        _emails: [],
        _stages: [],
        _notes: [],
        _callNotes: [],
        buildings: [],
        postalAddress: {
          street: lead.address || "",
          city: lead.city || "",
          province: lead.province || "",
          postalCode: lead.postalCode || "",
        },
        callStatus: lead.callStatus || "none",
        lastCallAt: lead.lastCallAt || "",
        nextCallAt: lead.nextCallAt || "",
        createdAt: lead.createdAt || nowIso(),
        updatedAt: lead.updatedAt || Date.now(),
        lookupStatus: lead.lookupStatus || "pending",
      });
    }
    const owner = byKey.get(key);
    if (lead.contactName) owner._contactNames.push(lead.contactName);
    if (lead.companyName) owner._companyNames.push(lead.companyName);
    if (lead.email) owner._emails.push(lead.email);
    if (Array.isArray(lead.phones)) for (const p of lead.phones) owner._phones.push(p);
    if (lead.phone) owner._phones.push(lead.phone);
    if (lead.stage) owner._stages.push(lead.stage);
    if (lead.notes) owner._notes.push(lead.notes);
    if (lead.callNotes) owner._callNotes.push(lead.callNotes);
    owner.buildings.push(buildingFromLead(lead));
    // If the incoming lead has fresher timestamps, bump the owner's.
    if (lead.updatedAt && lead.updatedAt > (owner.updatedAt || 0)) owner.updatedAt = lead.updatedAt;
  }
  const out = [];
  for (const owner of byKey.values()) {
    const phones = dedupPhones(owner._phones);
    const phoneSources = tagPhoneSources(phones, {}, "Migrated");
    const finalized = {
      ...owner,
      displayName: mostCommon(owner._contactNames) || mostCommon(owner._companyNames) || "(Propriétaire inconnu)",
      aliases: dedupStrings(owner._companyNames),
      contactNames: dedupStrings(owner._contactNames),
      phones,
      phoneSources,
      emails: dedupStrings(owner._emails),
      stage: pickBestStage(owner._stages),
      notes: owner._notes.join("\n\n").trim(),
      callNotes: owner._callNotes.join("\n\n").trim(),
    };
    delete finalized._contactNames;
    delete finalized._companyNames;
    delete finalized._phones;
    delete finalized._emails;
    delete finalized._stages;
    delete finalized._notes;
    delete finalized._callNotes;
    out.push(finalized);
  }
  return out;
}

// Upsert helper: merge a freshly-imported group of Owners into an existing
// list. Rules:
//   • If an Owner with the same ownerKey exists, extend its buildings/aliases/
//     phones/emails (deduped). Preserve existing stage/callNotes/timestamps —
//     the user has put work into those.
//   • New Owners are appended as-is.
// Returns { merged: Owner[], addedCount, updatedCount, unchangedCount }.
export function mergeOwners(existing, incoming) {
  const byKey = new Map();
  const order = [];
  for (const o of (Array.isArray(existing) ? existing : [])) {
    if (!o?.ownerKey) continue;
    if (!byKey.has(o.ownerKey)) {
      byKey.set(o.ownerKey, { ...o });
      order.push(o.ownerKey);
    }
  }
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const inc of (Array.isArray(incoming) ? incoming : [])) {
    if (!inc?.ownerKey) continue;
    const prev = byKey.get(inc.ownerKey);
    if (!prev) {
      byKey.set(inc.ownerKey, { ...inc });
      order.push(inc.ownerKey);
      addedCount++;
      continue;
    }
    const beforeSerialized = JSON.stringify([prev.aliases, prev.phones, prev.buildings?.length]);
    const mergedAliases = dedupStrings([...(prev.aliases || []), ...(inc.aliases || [])]);
    const mergedContactNames = dedupStrings([...(prev.contactNames || []), ...(inc.contactNames || [])]);
    const mergedPhones = dedupPhones([...(prev.phones || []), ...(inc.phones || [])]);
    const mergedEmails = dedupStrings([...(prev.emails || []), ...(inc.emails || [])]);
    // phoneSources: incoming wins only for NEW phones; existing phones keep
    // their original source tag (a Places hit stays "Places" even if the user
    // re-imports the CSV with that same number).
    const mergedPhoneSources = { ...(inc.phoneSources || {}), ...(prev.phoneSources || {}) };
    // Merge buildings by address-postal identity so re-importing the same CSV
    // doesn't stack duplicate building entries.
    const buildingKey = (b) => `${normalizeStreet(b.address)}|${normalizePostal(b.postalCode)}`;
    const seenB = new Set((prev.buildings || []).map(buildingKey));
    const mergedBuildings = [...(prev.buildings || [])];
    for (const b of (inc.buildings || [])) {
      const bk = buildingKey(b);
      if (seenB.has(bk)) continue;
      seenB.add(bk);
      mergedBuildings.push(b);
    }
    const next = {
      ...prev,
      aliases: mergedAliases,
      contactNames: mergedContactNames,
      phones: mergedPhones,
      phoneSources: mergedPhoneSources,
      emails: mergedEmails,
      buildings: mergedBuildings,
      displayName: prev.displayName || inc.displayName,
      matchedBusinessName: prev.matchedBusinessName || inc.matchedBusinessName || "",
      updatedAt: Date.now(),
    };
    byKey.set(inc.ownerKey, next);
    const afterSerialized = JSON.stringify([next.aliases, next.phones, next.buildings?.length]);
    if (beforeSerialized !== afterSerialized) updatedCount++;
    else unchangedCount++;
  }
  const merged = order.map(k => byKey.get(k));
  return { merged, addedCount, updatedCount, unchangedCount };
}

// ─── Owner-level phone lookup ───────────────────────────────────────────────
//
// Before owner-grouping, a single investor holding 58 buildings triggered 58
// rows of Google Places lookups. Most of those 58 rows issued near-identical
// queries (same owner address, same aliases) so we burned API dollars hitting
// the cache. The new shape sends ONE row per owner, using the owner mailing
// address + aliases as the query set. That collapses 58 → 1 for the worst
// offender in prod. See commit 9e67f0f for the budget cap that prompted this.
//
// The synthesized row reuses the exact column names that services/phoneEnrichment.js
// HEADER_PATTERNS recognises. It intentionally OMITS building civic/ lat-lng so
// the pipeline doesn't generate a building-address query (those vary per
// building and aren't the right fit for "find the investor's phone").
//
// Returns an array of { row, ownerId, ownerKey } so callers can map results
// back to the originating Owner record.
export function ownersToLookupRows(owners) {
  if (!Array.isArray(owners) || !owners.length) return [];
  const out = [];
  for (const owner of owners) {
    if (!owner?.ownerKey) continue;
    const p = owner.postalAddress || {};
    const ownerStreet = String(p.street || "").trim();
    const ownerCity = String(p.city || "").trim();
    const ownerProvince = String(p.province || "QC").trim() || "QC";
    const ownerPostal = String(p.postalCode || "").trim();
    // Need at LEAST a mailing street (or a postal with city) to run a useful
    // query. Skip otherwise — caller treats as "not enough info to lookup".
    if (!ownerStreet && !(ownerPostal && ownerCity)) continue;
    const aliases = Array.isArray(owner.aliases) ? owner.aliases : [];
    const displayName = String(owner.displayName || "").trim();
    // Put the human name first (best candidate for a business listing), then
    // each company alias. Cap at 4 to avoid blowing past the topN budget per row.
    const nameList = dedupStrings([displayName, ...aliases]).slice(0, 4);
    const row = {
      // Building-level fields left intentionally blank — the enrichment
      // pipeline skips building-address / nearby queries when they're empty.
      "Adresse": "",
      "Ville1": ownerCity,
      "Code Postal": "",
      "Province": ownerProvince,
      "Latitude": "",
      "Longitude": "",
    };
    nameList.forEach((name, i) => {
      const n = i + 1;
      row[`Propriétaire${n}_Nom`] = name;
      // All aliases share the same mailing address — that's the whole point.
      row[`Propriétaire${n}_Adresse`] = ownerStreet;
      row[`Propriétaire${n}_Code_Postal`] = ownerPostal;
      row[`Propriétaire${n}_Ville`] = ownerCity;
      row[`Propriétaire${n}_Province`] = ownerProvince;
    });
    out.push({ row, ownerId: owner.id, ownerKey: owner.ownerKey });
  }
  return out;
}

// Apply phone-lookup results back to an Owners list. Matches each result to
// its originating Owner via the `ownerId` we stamped on the request row, then
// merges new phones into owner.phones (deduped) and records lookupStatus.
//
// `results` is the array returned by /api/phone-lookup (each item has phone,
// candidates, status). `rowLookup` is the `ownersToLookupRows(...)` output so
// we can align by index.
export function applyLookupResultsToOwners(owners, results, rowLookup) {
  if (!Array.isArray(owners)) return { owners: [], touched: 0 };
  if (!Array.isArray(results) || !Array.isArray(rowLookup)) {
    return { owners, touched: 0 };
  }
  const byOwnerId = new Map(owners.map(o => [o.id, o]));
  let touched = 0;
  for (let i = 0; i < results.length && i < rowLookup.length; i++) {
    const res = results[i];
    const meta = rowLookup[i];
    if (!res || !meta) continue;
    const owner = byOwnerId.get(meta.ownerId);
    if (!owner) continue;
    const incomingPhones = [];
    if (res.phone) incomingPhones.push(res.phone);
    if (Array.isArray(res.candidates)) {
      for (const c of res.candidates) if (c?.phone) incomingPhones.push(c.phone);
    }
    const merged = dedupPhones([...(owner.phones || []), ...incomingPhones]);
    const phonesChanged = merged.length !== (owner.phones || []).length;
    // Tag every NEW phone as Places; keep existing phones' sources intact.
    const nextPhoneSources = { ...(owner.phoneSources || {}) };
    for (const p of merged) {
      const k = normalizePhoneKey(p);
      if (!k) continue;
      if (!nextPhoneSources[k]) nextPhoneSources[k] = "Places";
    }
    // Preserve the business name Places matched the owner to so the user can
    // audit "where did that number come from?" from the fiche.
    const matchedBusinessName = phonesChanged && res.matchedName
      ? String(res.matchedName)
      : (owner.matchedBusinessName || "");
    byOwnerId.set(meta.ownerId, {
      ...owner,
      phones: merged,
      phoneSources: nextPhoneSources,
      matchedBusinessName,
      lookupStatus: res.status || owner.lookupStatus || "pending",
      updatedAt: Date.now(),
    });
    if (phonesChanged || res.status) touched++;
  }
  const next = owners.map(o => byOwnerId.get(o.id) || o);
  return { owners: next, touched };
}
