// services/phoneLookupPlanner.js
//
// Planner for the "Recherche Tél" pipeline that classifies each Québec rôle
// d'évaluation row up-front — BEFORE any Google Places call is made — into one
// of three buckets:
//
//   1) use_file_phone        — row already carries a valid NANP phone in any
//                              of its phone columns. Skip Places entirely; the
//                              phone ships straight into the Leads list.
//   2) enrich_owner_postal   — row has no phone, GPT (or a deterministic
//                              fallback) pre-builds ONE Places Text Search
//                              query using the owner's MAILING address + a
//                              cleaned company name. Passed downstream to the
//                              phone-lookup engine as a pre-planned query.
//   3) skip_no_lead          — GPT has determined this row is not a business
//                              lead (e.g. individual owner at a residential
//                              Logement). Routed to a "needs manual review"
//                              bucket so the human operator can decide.
//
// Why this module exists: the legacy `normalizeRow` in phoneEnrichment.js does
// the same job with regex heuristics, but misses noisy real-world cases
// (Fiducie ... sans numéro, "Gestion ... enr.", composite names with both a
// person and a company). GPT sees the whole row at once and is much better at
// judging "is this a business we should call?" in one shot. We still keep the
// regex path as a fallback for when the OpenAI client is unavailable, rate-
// limited, or returns garbage.
//
// Contract:
//
//   planPhoneLookups({ rows, openaiClient, model, batchSize, concurrency, signal })
//     -> Promise<{ plans: Plan[], stats: {...} }>
//
//   Plan:
//     {
//       rowIdx,
//       strategy: "use_file_phone" | "enrich_owner_postal" | "skip_no_lead",
//       filePhones: string[],               // always an array; empty unless strategy === use_file_phone
//       plannedQuery: { query, expectedName, expectedAddress, expectedCivic } | null,
//       owner: { displayName, postalRaw, postalStreet, postalCity, postalProvince, postalCode, ownerKey },
//       building: { address, city, postalCode, utilisation, lat, lon },
//       reason: string,
//     }
//
// Design notes:
//   * Zero top-level side effects — safe to import from server code and tests.
//   * The only network call is the OpenAI chat.completions.create call, which
//     the caller can disable by passing `openaiClient: null`.
//   * Every code path is defensive against null / malformed rows. Failing on
//     one row must not poison the whole batch — we emit a deterministic plan
//     and keep going.
//   * No console.log output — only console.error when we actually catch an
//     error we chose to swallow.

import {
  extractOwnerPhones,
  extractBuildingPhones,
  normalizePhoneKey,
} from "./phoneEnrichment.js";

/* ========================================================================== *
 *  Street / postal / owner-key normalization
 *
 *  Re-implemented inline instead of imported from
 *  proforma-web/src/lib/ownerKey.js — that module lives in the frontend
 *  bundle and we don't want the server to reach into /proforma-web/. The
 *  logic here MIRRORS ownerKey.js exactly; keep them in sync if one changes.
 * ========================================================================== */

// Street-type words to drop from a normalized street. Mirrors ownerKey.js
// STREET_TYPES. Kept lowercase; token-level match after Saint expansion.
const STREET_TYPES = new Set([
  "rue", "r",
  "avenue", "av", "ave",
  "boulevard", "boul", "blvd", "bld",
  "chemin", "ch",
  "place", "pl",
  "croissant", "crois", "crt",
  "impasse",
  "allee", "allée",
  "ruelle",
  "route", "rte",
  "terrasse", "terr",
  "street", "st", "str",
  "road", "rd",
  "drive", "dr",
  "lane", "ln",
  "court", "ct",
  "way",
]);

// Drop "app./apt/suite/bureau/unité/#" markers and the adjacent number. Two
// separate patterns so "#" matches without a word boundary.
const WORD_UNIT_MARKERS = /\b(app(?:artement|t)?\.?|apt\.?|suite|bureau|unite|unité|unit)\s*[a-z]?-?\d+\w*/gi;
const HASH_UNIT_MARKERS = /#\s*\d+\w*/g;

function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Expand Saint/Sainte before case-folding / punctuation-stripping so that
// "Ste-Catherine", "St. Jean", "Ste Thérèse" all collapse to the same token.
function expandSaint(s) {
  return s
    .replace(/\bste[-.](?=\s*\w)/gi, "Sainte ")
    .replace(/\bst[-.](?=\s*\w)/gi, "Saint ")
    .replace(/\bSte\s+(?=[A-Z])/g, "Sainte ")
    .replace(/\bSt\s+(?=[A-Z])/g, "Saint ");
}

function stripUnits(s) {
  return s.replace(WORD_UNIT_MARKERS, " ").replace(HASH_UNIT_MARKERS, " ");
}

function stripPunctuation(s) {
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function collapseWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

function dropStreetTypes(s) {
  return s
    .split(" ")
    .filter(tok => tok && !STREET_TYPES.has(tok))
    .join(" ");
}

// Public: canonicalize a street address for owner grouping. Idempotent.
// Returns "" on empty input.
export function normalizeStreet(raw) {
  if (raw == null) return "";
  let s = String(raw);
  if (!s.trim()) return "";
  s = stripAccents(s);
  s = expandSaint(s);
  s = s.toLowerCase();
  s = stripUnits(s);
  s = stripPunctuation(s);
  s = collapseWs(s);
  s = dropStreetTypes(s);
  s = collapseWs(s);
  return s;
}

// Public: normalize a Canadian postal code. "H2Y 1M6" -> "h2y1m6".
// Invalid shape -> "".
export function normalizePostal(raw) {
  if (!raw) return "";
  const compact = String(raw).replace(/\s+/g, "").toLowerCase();
  if (!/^[a-z]\d[a-z]\d[a-z]\d$/.test(compact)) return "";
  return compact;
}

// Public: build the canonical grouping key. "|"-separated so downstream
// parsers can split reliably. Returns "" if both inputs normalize to empty.
export function buildOwnerKey(rawStreet, rawPostal) {
  const street = normalizeStreet(rawStreet);
  const postal = normalizePostal(rawPostal);
  if (!street && !postal) return "";
  return `${street}|${postal}`;
}

/* ========================================================================== *
 *  Postal-address parser — splits "1234 rue Main, Longueuil (Québec) J4K 1A1"
 *  Mirrors roleImport.js `parsePostalAddress` (lines 81-111).
 * ========================================================================== */

export function parsePostalAddress(raw) {
  let s = String(raw || "").trim();
  if (!s) return { street: "", city: "", province: "", postalCode: "" };

  // Strip trailing ", Canada" / " Canada" / " Canada." — rôle exports
  // frequently append it and it throws off the postal-code anchor.
  s = s.replace(/[,\s]+canada\.?\s*$/i, "").trim();

  // Postal code anchored at the end (allow optional space).
  const postalMatch = s.match(/([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$/);
  const postalCode = postalMatch ? postalMatch[1].trim() : "";
  let remainder = postalCode
    ? s.slice(0, s.length - postalMatch[0].length).trim()
    : s;
  remainder = remainder.replace(/[,\s]+$/, "");

  // Province in parens.
  let province = "";
  const provMatch = remainder.match(/\(([^)]+)\)\s*$/);
  if (provMatch) {
    province = provMatch[1].trim();
    remainder = remainder
      .slice(0, remainder.length - provMatch[0].length)
      .trim()
      .replace(/[,\s]+$/, "");
  }

  // Street / city on the LAST comma — street itself may contain a comma
  // ("100, rue Saint-Jacques, Montréal").
  let street = remainder;
  let city = "";
  const lastComma = remainder.lastIndexOf(",");
  if (lastComma >= 0) {
    street = remainder.slice(0, lastComma).trim();
    city = remainder.slice(lastComma + 1).trim();
  }

  return { street, city, province, postalCode };
}

/* ========================================================================== *
 *  Header-name normalizer + regex pickers
 *
 *  Rôle XLSX column headers are case/accent/punctuation-variant. We normalize
 *  both sides before comparing, then do exact-match on the normalized form.
 *  Mirrors roleImport.js `normalizeHeaderKey` (lines 38-46).
 * ========================================================================== */

export function normalizeHeaderKey(key) {
  return String(key || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Find the first original header in `row` whose normalized form equals
// `target` (also normalized). Returns "" if not found.
function findHeader(row, target) {
  const want = normalizeHeaderKey(target);
  for (const k of Object.keys(row || {})) {
    if (normalizeHeaderKey(k) === want) return k;
  }
  return "";
}

function readCell(row, headerLabel) {
  const h = findHeader(row, headerLabel);
  if (!h) return "";
  const v = row[h];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// Try multiple possible header labels and return the first non-empty hit.
// We need this because real-world Quebec rôle exports ship in two different
// column-naming conventions:
//   (A) "narrow" / short:  Propriétaire, Propriétaire 2, Adresse postale,
//                          Adresse postale 2, Téléphone, Téléphone 2
//   (B) "wide" / suffixed: Propriétaire1_Nom, Propriétaire2_Nom,
//                          Propriétaire1_Adresse, Propriétaire1_Téléphone,
//                          Propriétaire1_StatutImpositionScolaire
// Both refer to the SAME logical owner slot; we don't know which one a given
// upload will use.
function readCellAny(row, ...headerLabels) {
  for (const label of headerLabels) {
    const v = readCell(row, label);
    if (v) return v;
  }
  return "";
}

function readNumberCell(row, headerLabel) {
  const raw = readCell(row, headerLabel);
  if (!raw) return null;
  const n = Number(raw.replace(/[\s,$]/g, "").replace(/\u00a0/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* ========================================================================== *
 *  Row field extraction
 *
 *  `pickRowFields` pulls building + up-to-8 owner slots from a raw row using
 *  nothing but regex/header matching (no GPT). It is the single source of
 *  truth for what "the building" and "the owner slots" are on a row — both
 *  the pre-filter and the GPT prompt builder consume its output.
 * ========================================================================== */

export function pickRowFields(row) {
  const safeRow = row && typeof row === "object" ? row : {};

  const building = {
    address: readCell(safeRow, "Adresse Immeuble"),
    city: readCell(safeRow, "Ville"),
    postalCode: readCell(safeRow, "Code Postal Immeuble"),
    utilisation: readCell(safeRow, "Utilisation prédominante"),
    lat: readNumberCell(safeRow, "Lat"),
    lon: readNumberCell(safeRow, "Lon"),
  };

  // Collect up-to-8 owner slots. We support two header conventions:
  //
  //   Narrow (one row per building, owner fields repeat):
  //     Propriétaire           / Propriétaire 2
  //     Adresse postale        / Adresse postale 2
  //     Téléphone              / Téléphone 2
  //     Statut aux fins d'imposition scolaire / ... 2
  //
  //   Wide (cleaned rôle export, 8 owner slots per row):
  //     Propriétaire1_Nom      / Propriétaire2_Nom
  //     Propriétaire1_Adresse  / Propriétaire2_Adresse
  //                             (or Propriétaire1_Adresse_clean)
  //     Propriétaire1_Téléphone / Propriétaire2_Téléphone
  //     Propriétaire1_StatutImpositionScolaire
  //
  // Slot N in both conventions maps to the same logical owner. We probe the
  // wide form first (it's more specific and usually present when both are),
  // then fall back to the narrow form.
  const owners = [];
  for (let i = 0; i < 8; i++) {
    const n = i + 1;
    const narrowSuffix = i === 0 ? "" : ` ${n}`;
    const name = readCellAny(
      safeRow,
      `Propriétaire${n}_Nom`,        // wide
      `Propriétaire${narrowSuffix}`, // narrow
    );
    if (!name) continue;
    const status = readCellAny(
      safeRow,
      `Propriétaire${n}_StatutImpositionScolaire`,      // wide (no spaces)
      `Statut aux fins d'imposition scolaire${narrowSuffix}`, // narrow
    );
    const postalRaw = readCellAny(
      safeRow,
      `Propriétaire${n}_Adresse`,       // wide
      `Propriétaire${n}_Adresse_clean`, // wide (cleaned variant)
      `Adresse postale${narrowSuffix}`, // narrow
    );
    const phoneRaw = readCellAny(
      safeRow,
      `Propriétaire${n}_Téléphone`,                 // wide
      i === 0 ? "Téléphone" : `Téléphone ${n}`,      // narrow
    );
    const postal = parsePostalAddress(postalRaw);
    owners.push({
      slot: n,
      name,
      status,
      postalRaw,
      postalStreet: postal.street,
      postalCity: postal.city,
      postalProvince: postal.province,
      postalCode: postal.postalCode,
      phoneRaw,
    });
  }

  // Primary owner selection: prefer "Personne morale" (a legal entity → a
  // callable business) over "Personne physique" (a private individual).
  // Wide-format exports sometimes abbreviate to "Morale" / "Physique" with
  // no "Personne" prefix, so match on the meaningful suffix only.
  // Ties broken by slot order (slot 1 wins).
  const moral = owners.find(o => /morale/i.test(o.status));
  const primaryOwner = moral || owners[0] || null;

  return { building, owners, primaryOwner };
}

/* ========================================================================== *
 *  Row digest — compact representation fed into the GPT prompt
 *
 *  We don't want to dump the entire raw row (dozens of noisy columns) into
 *  the prompt — that inflates token costs and distracts the model. The digest
 *  is the minimal set of fields GPT needs to make its decision.
 * ========================================================================== */

export function buildRowDigest(row, rowIdx) {
  const fields = pickRowFields(row);
  const digest = {
    rowIdx,
    building: {
      address: fields.building.address,
      city: fields.building.city,
      postal: fields.building.postalCode,
      utilisation: fields.building.utilisation,
    },
    owners: fields.owners.map(o => ({
      slot: o.slot,
      name: o.name,
      status: o.status,
      postalAddress: o.postalRaw,
      hasPhoneInFile: normalizePhoneKey(o.phoneRaw) !== "",
    })),
  };
  return { digest, fields };
}

/* ========================================================================== *
 *  Prompt construction
 * ========================================================================== */

const SYSTEM_PROMPT = [
  "You are planning Google Places Text Search queries to find phone numbers for Quebec real estate owners.",
  "",
  "For each row you receive, decide:",
  "- If the owner is clearly a business (numbered company \"9440-5222 Québec Inc\", \"Gestion XYZ Inc.\", \"Fiducie Famille ...\", or any cell with Inc/Ltée/Ltd/Corp/SENC/Gestion/Immobilier/Holdings/Investissements): plan an \"owner_postal\" lookup.",
  "- If the owner is an individual (Statut = \"Personne physique\") at a residential Logement AND you see no sign of a business: return \"skip\" — this is a retail homeowner, not a business lead.",
  "- If there are multiple owners, prefer the \"Personne morale\" one; it is the registered business.",
  "",
  "For \"owner_postal\" plans, build ONE Google Places Text Search query string optimized for finding the business's phone. Best practices:",
  "- Start with the cleaned business name (strip trailing \"Inc.\", \"Ltée\", \" QUEBEC INC.\" ONLY if the result still looks searchable — keep numbered-company prefixes like \"9440-5222\").",
  "- Append the owner's MAILING address (Adresse postale), city, province, postal code, \"Canada\".",
  "- If the owner is a Personne physique with a business-sounding name (e.g. \"Pierre Tremblay Gestion Inc.\"), still use owner_postal.",
  "- Skip suite/apartment prefixes like \"800-511 Avenue des Pins\" → use \"511 Avenue des Pins\".",
  "",
  "Return JSON with this exact shape for the batch:",
  "{",
  "  \"plans\": [",
  "    {",
  "      \"rowIdx\": 0,",
  "      \"strategy\": \"owner_postal\" | \"skip\",",
  "      \"ownerName\": \"...\",",
  "      \"ownerNameForQuery\": \"...\",",
  "      \"ownerPostalClean\": \"...\",",
  "      \"reason\": \"one short sentence\"",
  "    }",
  "  ]",
  "}",
].join("\n");

export function buildBatchPrompt(digests) {
  return {
    system: SYSTEM_PROMPT,
    user: JSON.stringify({ rows: digests }, null, 2),
  };
}

/* ========================================================================== *
 *  Query string assembly
 * ========================================================================== */

// Extract the leading civic number from a cleaned postal street. Used as
// `expectedCivic` for result scoring downstream. Accepts up to 6 digits to
// cover weird rural numbering.
function leadingCivic(addr) {
  const m = String(addr || "").match(/^\s*(\d{1,6})/);
  return m ? m[1] : "";
}

// Concatenate non-empty parts with ", " separators. Drops empties so we never
// emit ", , ".
function joinParts(parts) {
  return parts.map(p => (p == null ? "" : String(p).trim())).filter(Boolean).join(", ");
}

// Build the four-field plannedQuery object for a row that's being sent to
// Places. Centralizes the "drop-empty" concatenation rule so the output shape
// is consistent whether we got the cleaned name from GPT or from the fallback.
function buildPlannedQuery({ nameForQuery, postalClean, city, province, postalCode }) {
  const queryStr = joinParts([
    nameForQuery,
    postalClean,
    city,
    province ? `QC ${postalCode || ""}`.trim() : postalCode,
    "Canada",
  ]);
  const expectedAddress = joinParts([
    postalClean,
    city,
    province ? `QC ${postalCode || ""}`.trim() : postalCode,
  ]);
  return {
    query: queryStr,
    expectedName: nameForQuery || "",
    expectedAddress,
    expectedCivic: leadingCivic(postalClean),
  };
}

/* ========================================================================== *
 *  Concurrency pool — no library dep, just a hand-rolled worker array
 * ========================================================================== */

// Run `tasks` with up to `concurrency` in flight at a time. `tasks` is an
// array of zero-arg functions returning Promises. Results are returned in the
// original order. Rejections are swallowed and returned as `{ error }` so one
// bad batch can't crash the whole run.
async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = [];
  const workerCount = Math.max(1, Math.min(concurrency | 0 || 1, tasks.length));
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (true) {
        const i = cursor++;
        if (i >= tasks.length) return;
        try {
          results[i] = await tasks[i]();
        } catch (err) {
          results[i] = { error: err };
        }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

/* ========================================================================== *
 *  Deterministic fallback — when GPT is unavailable or fails, we still want a
 *  usable plan. We use the rôle's raw owner + postal address, no cleaning,
 *  and strategy = enrich_owner_postal unless the row is obviously
 *  personne-physique residential.
 * ========================================================================== */

function deterministicFallbackPlan(rowIdx, fields, buildingPhones = []) {
  const primary = fields.primaryOwner;
  const building = fields.building;

  if (!primary) {
    return {
      rowIdx,
      strategy: "skip_no_lead",
      filePhones: [],
      buildingPhones,
      plannedQuery: null,
      owner: emptyOwner(),
      building: buildingShape(building),
      reason: "no_owner_on_row",
    };
  }

  // Residential + personne physique → likely retail homeowner, skip.
  // Wide-format rôle exports abbreviate the status to just "Physique" /
  // "Morale", so match on the core word not the full phrase.
  const utilIsLogement = /^logement$/i.test(building.utilisation || "");
  const isPhysique = /\bphysique\b/i.test(primary.status || "");
  if (utilIsLogement && isPhysique) {
    return {
      rowIdx,
      strategy: "skip_no_lead",
      filePhones: [],
      buildingPhones,
      plannedQuery: null,
      owner: ownerShape(primary),
      building: buildingShape(building),
      reason: "fallback_logement_personne_physique",
    };
  }

  // Default: enrich_owner_postal with the raw strings. Good enough for the
  // phone-lookup engine to make SOMETHING happen even without GPT cleaning.
  const plannedQuery = buildPlannedQuery({
    nameForQuery: primary.name,
    postalClean: primary.postalStreet,
    city: primary.postalCity,
    province: primary.postalProvince,
    postalCode: primary.postalCode,
  });
  return {
    rowIdx,
    strategy: "enrich_owner_postal",
    filePhones: [],
    buildingPhones,
    plannedQuery,
    owner: ownerShape(primary),
    building: buildingShape(building),
    reason: "fallback_deterministic_plan",
  };
}

/* ========================================================================== *
 *  Plan-object factories
 * ========================================================================== */

function emptyOwner() {
  return {
    displayName: "",
    postalRaw: "",
    postalStreet: "",
    postalCity: "",
    postalProvince: "",
    postalCode: "",
    ownerKey: "",
  };
}

function ownerShape(owner) {
  if (!owner) return emptyOwner();
  return {
    displayName: owner.name || "",
    postalRaw: owner.postalRaw || "",
    postalStreet: owner.postalStreet || "",
    postalCity: owner.postalCity || "",
    postalProvince: owner.postalProvince || "",
    postalCode: owner.postalCode || "",
    ownerKey: buildOwnerKey(owner.postalStreet || "", owner.postalCode || ""),
  };
}

function buildingShape(b) {
  if (!b) return { address: "", city: "", postalCode: "", utilisation: "", lat: null, lon: null };
  return {
    address: b.address || "",
    city: b.city || "",
    postalCode: b.postalCode || "",
    utilisation: b.utilisation || "",
    lat: b.lat ?? null,
    lon: b.lon ?? null,
  };
}

/* ========================================================================== *
 *  Pre-filter — file-phone detection happens before any GPT call
 * ========================================================================== */

function preFilter(row, rowIdx) {
  const { fields } = buildRowDigest(row, rowIdx);

  // Split the row's phones into OWNER phones (Téléphone, Propriétaire1_Téléphone,
  // etc.) and BUILDING phones (Téléphone Immeuble, etc.).
  //
  // Only OWNER phones short-circuit the pipeline to use_file_phone. A row that
  // has only a building phone still needs enrichment — the building number
  // usually reaches a superintendent or tenant, not the owner we want to pitch
  // an acquisition to. We keep the building phone on the plan as a weak
  // fallback the UI can surface, but we do NOT let it count as "solved".
  const ownerPhones = extractOwnerPhones(row || {});
  const buildingPhones = extractBuildingPhones(row || {});

  if (ownerPhones.length) {
    return {
      kind: "use_file_phone",
      plan: {
        rowIdx,
        strategy: "use_file_phone",
        filePhones: ownerPhones,
        buildingPhones,
        plannedQuery: null,
        owner: ownerShape(fields.primaryOwner),
        building: buildingShape(fields.building),
        reason: "file_phone_present",
      },
    };
  }

  // No owner phone — hand off to GPT / deterministic fallback. The
  // building-phone list travels with the plan so downstream result rows can
  // still show it as a last-resort contact number.
  return { kind: "needs_gpt", fields, buildingPhones };
}

/* ========================================================================== *
 *  GPT call — one batch
 *
 *  Returns `{ plans: GptPlan[], usage }` on success, or `null` on hard failure.
 *  A "hard failure" is anything that prevents us from getting parsed plans:
 *  network error, auth error, invalid JSON. The caller responds by falling
 *  back to deterministic plans for the affected rows.
 * ========================================================================== */

async function callGptBatch({ openaiClient, model, digests, signal }) {
  if (!openaiClient) return null;
  const { system, user } = buildBatchPrompt(digests);
  let response;
  try {
    response = await openaiClient.chat.completions.create(
      {
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      signal ? { signal } : undefined,
    );
  } catch (err) {
    console.error("[phoneLookupPlanner] batch failed:", err);
    return null;
  }
  const content = response?.choices?.[0]?.message?.content;
  if (!content) return null;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[phoneLookupPlanner] JSON parse failed:", err);
    return null;
  }
  const plans = Array.isArray(parsed?.plans) ? parsed.plans : [];
  return {
    plans,
    usage: {
      prompt_tokens: response?.usage?.prompt_tokens || 0,
      completion_tokens: response?.usage?.completion_tokens || 0,
    },
  };
}

// Merge one GPT plan with the deterministic `fields` for the same row.
function mergeGptPlan(gptPlan, fields, rowIdx, buildingPhones = []) {
  const primary = fields.primaryOwner;
  const building = fields.building;
  const strategy = String(gptPlan?.strategy || "").toLowerCase();
  const reason = String(gptPlan?.reason || "").trim() || "gpt_plan";

  if (strategy === "skip") {
    return {
      rowIdx,
      strategy: "skip_no_lead",
      filePhones: [],
      buildingPhones,
      plannedQuery: null,
      owner: ownerShape(primary),
      building: buildingShape(building),
      reason,
    };
  }

  // Default: owner_postal. If GPT didn't give us cleaned strings, fall back
  // to the raw owner data — this is the "malformed JSON / missing fields"
  // safety net.
  const nameForQuery =
    String(gptPlan?.ownerNameForQuery || "").trim() ||
    (primary?.name || "");
  const postalClean =
    String(gptPlan?.ownerPostalClean || "").trim() ||
    (primary?.postalStreet || "");

  // Use the primary owner's city / province / postal code — GPT is not
  // asked to re-copy those and would just parrot them back unreliably.
  const plannedQuery = buildPlannedQuery({
    nameForQuery,
    postalClean,
    city: primary?.postalCity || "",
    province: primary?.postalProvince || "",
    postalCode: primary?.postalCode || "",
  });

  const owner = ownerShape(primary);
  // Recompute ownerKey using the GPT-cleaned street if we got one; this
  // groups "800-511 Avenue des Pins" with "511 Avenue des Pins".
  owner.ownerKey = buildOwnerKey(
    postalClean || owner.postalStreet,
    owner.postalCode,
  );

  return {
    rowIdx,
    strategy: "enrich_owner_postal",
    filePhones: [],
    buildingPhones,
    plannedQuery,
    owner,
    building: buildingShape(building),
    reason,
  };
}

/* ========================================================================== *
 *  Public entry point
 * ========================================================================== */

export async function planPhoneLookups({
  rows,
  openaiClient,
  model = "gpt-4o-mini",
  batchSize = 20,
  concurrency = 3,
  signal,
} = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const plans = new Array(safeRows.length);
  const stats = {
    total: safeRows.length,
    useFilePhone: 0,
    enrichOwnerPostal: 0,
    skipNoLead: 0,
    gptCallCount: 0,
    gptTokensIn: 0,
    gptTokensOut: 0,
  };

  // Step 1 — pre-filter. Any row whose raw values already contain a valid
  // NANP phone is resolved right here; only the remainder goes to GPT.
  const needsGpt = []; // { rowIdx, fields, digest, buildingPhones }
  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i];
    try {
      const pf = preFilter(row, i);
      if (pf.kind === "use_file_phone") {
        plans[i] = pf.plan;
      } else {
        const { digest } = buildRowDigest(row, i);
        needsGpt.push({
          rowIdx: i,
          fields: pf.fields,
          digest,
          buildingPhones: pf.buildingPhones || [],
        });
      }
    } catch (err) {
      console.error("[phoneLookupPlanner] pre-filter failed for row", i, err);
      // If even the pre-filter blows up, fall back to an empty-shaped
      // skip_no_lead plan so downstream code doesn't see `undefined`.
      plans[i] = {
        rowIdx: i,
        strategy: "skip_no_lead",
        filePhones: [],
        buildingPhones: [],
        plannedQuery: null,
        owner: emptyOwner(),
        building: buildingShape(null),
        reason: "prefilter_error",
      };
    }
  }

  // Step 2 — batch the rows that need GPT. `batchSize` rows per call; up to
  // `concurrency` calls in flight.
  const batches = [];
  for (let i = 0; i < needsGpt.length; i += Math.max(1, batchSize | 0)) {
    batches.push(needsGpt.slice(i, i + Math.max(1, batchSize | 0)));
  }

  const tasks = batches.map(batch => async () => {
    const digests = batch.map(b => b.digest);
    const result = await callGptBatch({ openaiClient, model, digests, signal });
    return { batch, result };
  });

  const poolResults = await runPool(tasks, concurrency);

  // Step 3 — merge results back into `plans`, using deterministic fallback
  // for any missing / failed / malformed GPT plan.
  for (const pr of poolResults) {
    // Pool catches rejections for us; if we got an `error` object, all rows
    // in that batch get deterministic plans.
    if (!pr || pr.error) {
      // Can't recover the batch contents if runPool caught an error and
      // didn't return `batch`; but our `tasks` above never throw before
      // returning `{ batch, result }`, so `pr.batch` is only missing for
      // genuine programming errors. Handle the edge case anyway.
      continue;
    }
    const { batch, result } = pr;
    if (!result) {
      // Whole batch failed → deterministic plans for all rows.
      for (const b of batch) {
        plans[b.rowIdx] = deterministicFallbackPlan(b.rowIdx, b.fields, b.buildingPhones);
      }
      continue;
    }
    // Successful call — record usage + count.
    stats.gptCallCount++;
    stats.gptTokensIn += result.usage?.prompt_tokens || 0;
    stats.gptTokensOut += result.usage?.completion_tokens || 0;
    // Index returned plans by rowIdx for O(1) lookup.
    const byIdx = new Map();
    for (const p of result.plans || []) {
      if (p && typeof p === "object" && Number.isInteger(p.rowIdx)) {
        byIdx.set(p.rowIdx, p);
      }
    }
    for (const b of batch) {
      const gptPlan = byIdx.get(b.rowIdx);
      if (!gptPlan) {
        // GPT omitted this row → deterministic fallback.
        plans[b.rowIdx] = deterministicFallbackPlan(b.rowIdx, b.fields, b.buildingPhones);
      } else {
        plans[b.rowIdx] = mergeGptPlan(gptPlan, b.fields, b.rowIdx, b.buildingPhones);
      }
    }
  }

  // Edge case: rows that were queued for GPT but runPool dropped on a
  // programming error. Cover them with deterministic plans so the output
  // array has no gaps.
  for (const n of needsGpt) {
    if (!plans[n.rowIdx]) {
      plans[n.rowIdx] = deterministicFallbackPlan(n.rowIdx, n.fields, n.buildingPhones);
    }
  }

  // Step 4 — final tally. Count each plan exactly once, by strategy. This is
  // the single source of truth for the three bucket counts; we intentionally
  // do NOT increment in the per-row loops above so a double-count bug is
  // impossible.
  for (const p of plans) {
    if (!p) continue;
    if (p.strategy === "use_file_phone") stats.useFilePhone++;
    else if (p.strategy === "enrich_owner_postal") stats.enrichOwnerPostal++;
    else if (p.strategy === "skip_no_lead") stats.skipNoLead++;
  }

  return { plans, stats };
}
