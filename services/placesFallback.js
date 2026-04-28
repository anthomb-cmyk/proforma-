// services/placesFallback.js
//
// Pure module that runs ONE Google Places lookup per package as a last-resort
// fallback when the Brave/Serper web-search pipeline returns no contact.
//
// Design contract
// ───────────────
//   • Zero side effects — no caching, no retries, no state mutation.
//   • Does NOT touch the old /api/phone-lookup flow.
//   • The Places client is injected so tests can supply a mock with no
//     network access.
//   • One Places Text Search call + one Details call at most.
//
// Typical call cost: ~$0.017 (Text Search) + ~$0.017 (Details) = ~$0.034 USD.
// The caller is responsible for gating by status==="no_contact_found" so the
// call only happens when Brave already returned nothing.

import {
  isPackagePlacesEligible,
  canUseBuildingAddressAsQuery,
  canUseMailingAddressAsQuery,
  canUseOwnerNameAsQuery,
  hasBlockedType,
} from "./placesQueryGate.js";

// ─── Query builder ───────────────────────────────────────────────────────────

/**
 * Build the best possible text-search query for the given package.
 *
 * Priority:
 *   1. Mailing address (most precise — highest likelihood of exact listing)
 *   2. Building address (commercial-only; residential-rental addresses are blocked)
 *   3. Owner name alone (for named-queryable entity categories)
 *
 * Returns null when no anchor is available.
 *
 * @param {object} pkg
 * @returns {string|null}
 */
function buildSearchQuery(pkg) {
  // 1. Mailing address — preferred anchor
  const mailingCheck = canUseMailingAddressAsQuery(pkg);
  if (mailingCheck.allowed) {
    // Prefer mailingAddresses[] (extractor output) over flat fields.
    if (Array.isArray(pkg.mailingAddresses) && pkg.mailingAddresses.length > 0) {
      const a = pkg.mailingAddresses[0];
      const parts = [
        String(a.street || "").trim(),
        String(a.city || "").trim(),
        String(a.province || "").trim() || "QC",
      ].filter(Boolean);
      if (parts.length > 0) {
        const ownerName = String(pkg.lead_owner_name || "").trim();
        return ownerName ? `${ownerName} ${parts.join(", ")}` : parts.join(", ");
      }
    }
    // Fall back to flat mailing_* fields.
    const street = String(pkg.mailing_address || "").trim();
    const city = String(pkg.mailing_city || "").trim();
    const prov = String(pkg.mailing_province || "QC").trim();
    const addr = [street, city, prov].filter(Boolean).join(", ");
    if (addr) {
      const ownerName = String(pkg.lead_owner_name || "").trim();
      return ownerName ? `${ownerName} ${addr}` : addr;
    }
  }

  // 2. Building address (commercial / unknown utilisation only)
  const buildingCheck = canUseBuildingAddressAsQuery(pkg);
  if (buildingCheck.allowed) {
    const addr = String(pkg.address || pkg.building_address || "").trim();
    if (addr) {
      const ownerName = String(pkg.lead_owner_name || "").trim();
      return ownerName ? `${ownerName} ${addr}` : addr;
    }
  }

  // 3. Owner name alone (name-queryable categories)
  const nameCheck = canUseOwnerNameAsQuery(pkg);
  if (nameCheck.allowed) {
    const name = String(pkg.lead_owner_name || "").trim();
    const city = String(pkg.mailing_city || "").trim();
    const prov = String(pkg.mailing_province || "QC").trim();
    // Add geographic context to disambiguate.
    return [name, city, prov].filter(Boolean).join(", ");
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a single Google Places lookup for a package and return a structured result.
 *
 * @param {object}   opts
 * @param {object}   opts.pkg           Search-package object
 * @param {object}   opts.placesClient  Created by createPlacesClient() — must
 *   expose at least { textSearch(query), details(placeId) }.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   phone?: string,
 *   businessName?: string,
 *   address?: string,
 *   placeId?: string,
 *   types?: string[],
 *   evidence: string[],
 *   reason?: string,
 * }>}
 */
export async function runPlacesFallback({ pkg, placesClient }) {
  const evidence = [];

  // Step 1: eligibility gate
  const { eligible, reason: eligReason } = isPackagePlacesEligible(pkg);
  if (!eligible) {
    return {
      ok: false,
      reason: "not_eligible",
      evidence: [`places_not_eligible: ${eligReason}`],
    };
  }

  // Step 2: build search query
  const query = buildSearchQuery(pkg);
  if (!query) {
    return {
      ok: false,
      reason: "no_query_anchor",
      evidence: ["places_no_query_anchor: no mailing/building/name anchor available"],
    };
  }
  evidence.push(`places_query: "${query}"`);

  // Step 3: text search
  let results;
  try {
    results = await placesClient.textSearch(query);
  } catch (err) {
    const msg = String(err?.message || err);
    evidence.push(`places_search_error: ${msg}`);
    return { ok: false, reason: "search_error", evidence };
  }

  if (!Array.isArray(results) || results.length === 0) {
    evidence.push("places_no_results: textSearch returned 0 results");
    return { ok: false, reason: "no_results", evidence };
  }

  // Step 4: blocked-type check on first result
  const first = results[0];
  const rawTypes = Array.isArray(first.types) ? first.types : [];
  if (hasBlockedType(rawTypes)) {
    evidence.push(`places_blocked_type: ${rawTypes.join(", ")}`);
    return { ok: false, reason: "blocked_type", evidence };
  }

  const placeId = first.place_id || null;
  const roughName = String(first.name || "").trim();
  const roughAddress = String(first.formatted_address || first.vicinity || "").trim();

  // Step 5: fetch details for phone number
  let phone = null;
  let businessName = roughName;
  let address = roughAddress;
  let types = rawTypes;

  if (placeId) {
    try {
      const detail = await placesClient.details(placeId);
      if (detail && typeof detail === "object") {
        phone =
          String(detail.formatted_phone_number || detail.international_phone_number || "").trim()
          || null;
        businessName = String(detail.name || roughName).trim();
        address = String(detail.formatted_address || roughAddress).trim();
        types = Array.isArray(detail.types) ? detail.types : rawTypes;
      }
    } catch (err) {
      // Details errors are non-fatal — we still return no_phone rather than crashing.
      evidence.push(`places_details_error: ${String(err?.message || err)}`);
    }
  }

  if (!phone) {
    evidence.push(`places_no_phone: place "${businessName}" found but carries no phone`);
    return { ok: false, reason: "no_phone", evidence };
  }

  // Step 6: success
  evidence.push(`places_found: "${businessName}" phone=${phone} address="${address}"`);

  return {
    ok: true,
    phone,
    businessName,
    address,
    placeId,
    types,
    evidence,
  };
}
