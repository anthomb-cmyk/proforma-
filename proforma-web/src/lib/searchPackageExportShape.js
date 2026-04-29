/**
 * Pure helper that builds the export row shape expected by importPhoneFinderResultsToLeads.
 *
 * Extracted from SearchPackagePreview.jsx so it can be unit-tested in isolation.
 * The importer reads buildingAddress / inputAddress / matchedAddress to form a unique
 * identity key per property — without these, every lead with the same company name
 * collapses to the same key and subsequent exports are silently skipped as duplicates.
 */
import { extractCityFromAddress } from "./buildingCity.js";

export { extractCityFromAddress };

export function buildExportRowFromResult(r, helpers = {}) {
  const propertyAddress = r.address || r.mailing_address || "";
  return {
    companyName: r.lead_owner_name || "",
    lead_owner_name: r.lead_owner_name || "",
    leadContact: r.lead_owner_name || "",
    buildingAddress: propertyAddress,
    inputAddress: propertyAddress,
    matchedAddress: propertyAddress,
    mailing_address: r.mailing_address || "",
    mailing_city: r.mailing_city || "",
    // Prefer building_city (property municipality) over mailing/postal city.
    // Falls back to parsing city from the address string, then mailing_city.
    city: r.building_city
      || (propertyAddress && extractCityFromAddress(propertyAddress))
      || r.mailing_city
      || "",
    phone: r.bestPhone || "",
    bestPhone: r.bestPhone || "",
    email: r.bestEmail || "",
    bestEmail: r.bestEmail || "",
    website: r.bestWebsite || "",
    bestWebsite: r.bestWebsite || "",
    source: "enrichment_web_search",
    status: r.status || "ready_to_call",
    candidatePhones: r.bestPhone ? [helpers.enrichResultToCandidatePhone?.(r)].filter(Boolean) : [],
    candidateEmails: r.bestEmail ? [{ email: r.bestEmail, source: "enrichment_web_search" }] : [],
    candidateWebsites: r.bestWebsite ? [{ website: r.bestWebsite, source: "enrichment_web_search" }] : [],
    evidence: Array.isArray(r.evidence) ? r.evidence.slice(-4).join(" | ") : "",
  };
}

/**
 * Pure helper that builds the export summary object from the importer result.
 *
 * importPhoneFinderResultsToLeads returns {added, updated, skipped} — this maps
 * those real counts into the summary shape so the toast tells the truth.
 */
export function buildExportSummary(result, totalSent, breakdown = {}) {
  return {
    added: Number(result?.added) || 0,
    updated: Number(result?.updated) || 0,
    skippedByImporter: Number(result?.skipped) || 0,
    totalSent,
    skippedReview: breakdown.skippedReview || 0,
    skippedNoContact: breakdown.skippedNoContact || 0,
    skippedAlreadyExported: breakdown.skippedAlreadyExported || 0,
  };
}
