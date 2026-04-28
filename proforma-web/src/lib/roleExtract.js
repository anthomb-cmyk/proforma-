// proforma-web/src/lib/roleExtract.js
//
// Universal Québec rôle owner/address extractor. Supplements roleImport.js
// (which handles the full Owner/Lead import pipeline for Format A) by
// covering all four confirmed export formats for the enrichment-preview path.
//
// Format A/C  Longueuil / Sherbrooke — space-separated slot suffixes
//             Propriétaire, Propriétaire 2 … Adresse postale, Adresse postale 2 …
//             Téléphone, Téléphone 2 … (Format C is identical after normalization)
//
// Format B    Compact indexed — digit concatenated into column name
//             Propriétaire1_Nom, Propriétaire1_Adresse, Propriétaire1_Téléphone
//             Propriétaire2_Nom, Propriétaire2_Adresse …
//
// Format D    Prospection template — distinct vocabulary, single owner slot
//             Nom_proprio, Adresse_proprio, Ville_code_postal_proprio
//             Code postal-proprio
//
// Public API:
//   detectRoleFormat(normHeaders)          → 'A_C' | 'B' | 'D' | 'unknown'
//   extractOwnerSlotsFromRow(row, headers) → OwnerSlot[]
//   buildSearchAnchors(ownerSlot)          → string[]

import { normalizeHeaderKey, parsePostalAddress } from "./roleImport.js";
import { mergePhoneLists } from "./phoneUtils.js";
import { makePhoneCandidate } from "./contactCandidates.js";

// ─── Format detection ──────────────────────────────────────────────────────

/**
 * Detect the export format from a list of already-normalized header strings.
 *
 * Detection order is most-specific first so a sheet that accidentally has both
 * "Propriétaire1_Nom" and "Propriétaire" columns is classified as B.
 *
 * @param {string[]} normHeaders  Pre-normalized header keys
 * @returns {'A_C' | 'B' | 'D' | 'unknown'}
 */
export function detectRoleFormat(normHeaders) {
  const hs = Array.isArray(normHeaders) ? normHeaders : [];

  // Format B: digit immediately concatenated to "proprietaire" — no space before it.
  // e.g. "proprietaire1 nom", "proprietaire2 adresse", "proprietaire1 telephone"
  if (hs.some((n) => /^proprietaire\d/.test(n))) return "B";

  // Format D: uses "proprio" vocabulary instead of "proprietaire"
  // e.g. "nom proprio", "adresse proprio", "ville code postal proprio"
  if (hs.some((n) => n.includes("proprio"))) return "D";

  // Format A/C: "proprietaire" alone (slot 0) or with " N" suffix (slot N).
  // Sherbrooke's "Adresse Postale 2" normalizes identically to Longueuil's
  // "Adresse postale 2" so no separate branch is needed.
  if (hs.some((n) => /^proprietaire(\s+\d+)?$/.test(n))) return "A_C";

  return "unknown";
}

// ─── Internal column helpers ────────────────────────────────────────────────

// Return the raw header string whose normalized form exactly equals `target`.
function findExact(headers, target) {
  const want = normalizeHeaderKey(target);
  return (headers || []).find((h) => normalizeHeaderKey(h) === want) || "";
}

// ─── Slot-descriptor builders ──────────────────────────────────────────────

// Format A/C: Propriétaire (slot 0), Propriétaire 2 (slot 1), …
// Adresse postale (slot 0), Adresse postale 2 (slot 1), …
// Téléphone (slot 0), Téléphone 2 (slot 1), …
function buildSlotsAC(headers) {
  const slots = [];
  for (let idx = 0; idx < 8; idx++) {
    const suffix = idx === 0 ? "" : ` ${idx + 1}`;
    const nameCol = findExact(headers, `Propriétaire${suffix}`);
    if (!nameCol) continue;
    slots.push({
      idx,
      format: "A_C",
      nameCol,
      firstNameCol: findExact(headers, `Propriétaire${suffix} Prénom`),
      lastNameCol: findExact(headers, `Propriétaire${suffix} Nom`),
      statusCol: findExact(headers, `Statut aux fins d'imposition scolaire${suffix}`),
      // addressCols is an array to support future multi-address slots
      addressCols: [findExact(headers, `Adresse postale${suffix}`)].filter(Boolean),
      phoneCol: findExact(headers, `Téléphone${suffix}`),
    });
  }
  return slots;
}

// Format B: Propriétaire1_Nom (slot 0), Propriétaire2_Nom (slot 1), …
// Some exports omit "_Nom" and use just "Propriétaire1" — fall back to that.
function buildSlotsB(headers) {
  const slots = [];
  for (let idx = 0; idx < 8; idx++) {
    const n = idx + 1; // 1-based digit in column name
    const nameCol =
      findExact(headers, `Propriétaire${n}_Nom`) ||
      findExact(headers, `Propriétaire${n}`);
    if (!nameCol) continue;
    slots.push({
      idx,
      format: "B",
      nameCol,
      firstNameCol: findExact(headers, `Propriétaire${n}_Prénom`),
      lastNameCol: "",
      statusCol: "",
      addressCols: [findExact(headers, `Propriétaire${n}_Adresse`)].filter(Boolean),
      phoneCol: findExact(headers, `Propriétaire${n}_Téléphone`),
    });
  }
  return slots;
}

// Format D: single owner slot with a different column vocabulary.
// City + postal may be combined in one column (Ville_code_postal_proprio)
// or postal may be in a separate Code postal-proprio column.
//
// Phone / email / website columns have multiple naming variants in the wild —
// we accept any of them and pick the first that matches.
function buildSlotsD(headers) {
  const nameCol = findExact(headers, "Nom_proprio");
  if (!nameCol) return [];
  return [
    {
      idx: 0,
      format: "D",
      nameCol,
      firstNameCol: findExact(headers, "Prénom_proprio"),
      lastNameCol: "",
      statusCol: "",
      addressCols: [findExact(headers, "Adresse_proprio")].filter(Boolean),
      // Format D splits city+postal into a dedicated column; keep separately
      // so extractMailingAddresses can parse them correctly.
      cityPostalCol: findExact(headers, "Ville_code_postal_proprio"),
      postalCol: findExact(headers, "Code postal-proprio"),
      phoneCol:
        findExact(headers, "Téléphone_proprio") ||
        findExact(headers, "Telephone_proprio") ||
        findExact(headers, "Tel_proprio") ||
        findExact(headers, "Phone_proprio"),
      emailCol:
        findExact(headers, "Courriel_proprio") ||
        findExact(headers, "Email_proprio"),
      websiteCol:
        findExact(headers, "Site_web_proprio") ||
        findExact(headers, "Site web_proprio") ||
        findExact(headers, "Website_proprio"),
    },
  ];
}

// ─── Address extraction ─────────────────────────────────────────────────────

// Build mailing address objects from slot descriptor + raw row.
// Returns an array; most slots produce exactly one address, but the array
// shape is consistent so callers can treat every slot the same way.
function extractMailingAddresses(row, slot) {
  const addresses = [];

  if (slot.format === "D") {
    const streetRaw = slot.addressCols.length
      ? String(row[slot.addressCols[0]] || "").trim()
      : "";
    const cityPostalRaw = slot.cityPostalCol
      ? String(row[slot.cityPostalCol] || "").trim()
      : "";
    const postalOnly = slot.postalCol
      ? String(row[slot.postalCol] || "").trim()
      : "";

    if (!streetRaw && !cityPostalRaw) return [];

    // Parse "Sherbrooke J1K 2T5" or "Sherbrooke (Québec) J1K 2T5"
    let city = "";
    let province = "";
    let postalCode = postalOnly;

    if (cityPostalRaw) {
      const postalMatch = cityPostalRaw.match(
        /([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$/,
      );
      if (postalMatch) {
        postalCode = postalCode || postalMatch[1].trim();
        let rem = cityPostalRaw
          .slice(0, cityPostalRaw.length - postalMatch[0].length)
          .trim()
          .replace(/[,\s]+$/, "");
        const provMatch = rem.match(/\(([^)]+)\)\s*$/);
        if (provMatch) {
          province = provMatch[1].trim();
          rem = rem
            .slice(0, rem.length - provMatch[0].length)
            .trim()
            .replace(/[,\s]+$/, "");
        }
        city = rem;
      } else {
        city = cityPostalRaw;
      }
    }

    if (streetRaw || city) {
      addresses.push({
        street: streetRaw,
        city,
        province: province || "QC",
        postalCode,
        raw: [streetRaw, cityPostalRaw].filter(Boolean).join(", "),
      });
    }
  } else {
    // Format A/C and B: each addressCol holds a combined
    // "street, city (province) postal" string — delegate to parsePostalAddress.
    for (const col of slot.addressCols) {
      const raw = String(row[col] || "").trim();
      if (!raw) continue;
      const parsed = parsePostalAddress(raw);
      addresses.push({
        street: parsed.street,
        city: parsed.city,
        province: parsed.province || "QC",
        postalCode: parsed.postalCode,
        raw,
      });
    }
  }

  return addresses;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract all owner slots from a single spreadsheet row.
 *
 * Header detection is performed every call — headers don't change within a
 * sheet so callers may cache the result of `headers.map(normalizeHeaderKey)`
 * and the slot descriptors if performance matters, but for the preview path
 * the call count is small enough that this is not necessary.
 *
 * @param {object}   row      Spreadsheet row (keys = raw header strings)
 * @param {string[]} headers  Full raw header list for the sheet
 * @returns {OwnerSlot[]}     One object per populated slot, in slot order
 *
 * OwnerSlot shape:
 *   slotIdx        {number}   0-based slot index
 *   name           {string}   Full name as it appears in the column
 *   firstName      {string}   First name when available (else "")
 *   lastName       {string}   Last name when available (else "")
 *   status         {string}   "Personne physique" / "Personne morale" when available
 *   mailingAddresses {object[]} One per distinct address found in this slot
 *     .street  .city  .province  .postalCode  .raw
 *   phones         {string[]} Deduped display-formatted phone numbers
 *   candidatePhones {object[]} Full candidate objects with source attribution
 */
export function extractOwnerSlotsFromRow(row, headers) {
  if (!row || typeof row !== "object" || !Array.isArray(headers)) return [];

  const normHeaders = headers.map(normalizeHeaderKey);
  const format = detectRoleFormat(normHeaders);

  let slotDescs;
  if (format === "B") slotDescs = buildSlotsB(headers);
  else if (format === "D") slotDescs = buildSlotsD(headers);
  else if (format === "A_C") slotDescs = buildSlotsAC(headers);
  else return [];

  const results = [];
  for (const slot of slotDescs) {
    const name = String(row[slot.nameCol] || "").trim();
    if (!name) continue;

    const firstName = slot.firstNameCol
      ? String(row[slot.firstNameCol] || "").trim()
      : "";
    const lastName = slot.lastNameCol
      ? String(row[slot.lastNameCol] || "").trim()
      : "";
    const status = slot.statusCol
      ? String(row[slot.statusCol] || "").trim()
      : "";
    const phoneRaw = slot.phoneCol
      ? String(row[slot.phoneCol] || "").trim()
      : "";
    const phones = mergePhoneLists(phoneRaw);
    const mailingAddresses = extractMailingAddresses(row, slot);

    const candidatePhones = phones
      .map((p) =>
        makePhoneCandidate({
          phone: p,
          source: "file",
          source_column: slot.phoneCol,
          phone_owner_name: name,
          relationship_to_lead_owner: "owner",
          evidence: `rôle slot ${slot.idx + 1} (format ${slot.format}): ${slot.phoneCol}`,
        }),
      )
      .filter(Boolean);

    results.push({
      slotIdx: slot.idx,
      name,
      firstName,
      lastName,
      status,
      mailingAddresses,
      phones,
      candidatePhones,
    });
  }

  return results;
}

/**
 * Build search-anchor strings for a single owner slot.
 *
 * Returns one formatted address string per mailing address. These feed into
 * buildMailingAddressDiscoveryQueries (or its multi-address variant) to
 * generate the actual web-search query variants.
 *
 * The building/property address is intentionally excluded — it identifies a
 * physical asset (what the owner owns), not where the owner can be found.
 *
 * @param {object} ownerSlot  Canonical slot from extractOwnerSlotsFromRow
 * @returns {string[]}        One "street, city, province, postal" string per address
 */
export function buildSearchAnchors(ownerSlot) {
  if (!ownerSlot?.mailingAddresses?.length) return [];
  return ownerSlot.mailingAddresses
    .filter((a) => a.street || (a.city && a.postalCode))
    .map((a) =>
      [a.street, a.city, a.province, a.postalCode].filter(Boolean).join(", "),
    );
}
