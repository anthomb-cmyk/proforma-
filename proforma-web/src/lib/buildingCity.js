/**
 * buildingCity.js
 *
 * Pure helpers for extracting the BUILDING city (not the owner's postal/
 * mailing city) from raw role-file rows and address strings.
 *
 * Background: QC role files (Format D "Prospection") contain a column
 * "Ville_code_postal_proprio" which is the owner's MAILING city. A loose
 * regex like /\bville\d*\b/i would accidentally pick that column, polluting
 * lead.city with postal city instead of the property's actual municipality.
 */

// Owner / mailing-city aliases that must never be picked as building city.
// Covers the original "proprio|postal" set plus broader aliases that were
// previously let through (e.g. ville_proprietaire, owner_ville,
// mailing_ville, correspondance_ville).  (Codex P2-A)
const OWNER_CITY_HINT_RE = /proprio|propri[eé]taire|owner|mailing|correspondance|postal|adresse[\s_-]*postal/i;

/**
 * Pick the building city from a raw CSV/role-file row object.
 *
 * Priority:
 *   1. Explicit "Ville (immeuble)" / "Ville-immeuble" / "Ville_immeuble"
 *   2. Plain "Ville" / "Ville1" / "Ville2" (conventional building-city in QC rôle files)
 *      — but NEVER columns containing an owner/mailing-city hint
 *   3. Any other "ville*" column that does NOT contain an owner/mailing-city hint
 *
 * Returns "" when no suitable column is found, including when the only
 * ville-named column is "Ville_code_postal_proprio" or similar.
 */
export function pickBuildingCityFromRawRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return "";
  const entries = Object.entries(rawRow);

  // Priority 1: explicit "Ville (immeuble)" / "Ville-immeuble" / "Ville_immeuble"
  const exact = entries.find(([k]) => /\bville[\s_(/-]*immeuble\b/i.test(k));
  if (exact && exact[1]) return String(exact[1]).trim();

  // Priority 2: plain "Ville" / "Ville1" / "Ville2" (no suffix indicating it's mailing city)
  const plain = entries.find(([k]) => /^ville\d*$/i.test(k.trim()));
  if (plain && plain[1]) return String(plain[1]).trim();

  // Priority 3: any "ville*" column NOT tagged with an owner/mailing-city hint
  const fallback = entries.find(([k]) => {
    if (!/ville/i.test(k)) return false;
    if (OWNER_CITY_HINT_RE.test(k)) return false;
    return true;
  });
  if (fallback && fallback[1]) return String(fallback[1]).trim();

  return "";
}

/**
 * Extract the city name from a full QC-style address string.
 *
 * Typical format: "123 rue X, Montréal, QC, H2X 1A1"
 *              or "123 rue X, Montréal QC, H2X 1A1"
 *
 * Returns "" for short/unparseable inputs.
 */
export function extractCityFromAddress(addr) {
  if (!addr || typeof addr !== "string") return "";
  const parts = addr.split(",").map(s => s.trim()).filter(Boolean);
  // Need at least a street + city segment
  if (parts.length < 2) return "";
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    // Skip postal codes (QC pattern: letter-digit-letter digit-letter-digit)
    if (/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i.test(seg)) continue;
    // Skip pure province tokens
    if (/^(QC|QU[EÉ]BEC)$/i.test(seg)) continue;
    // Strip trailing province token that may appear in the same segment ("Montréal QC")
    return seg.replace(/\s+(QC|QU[EÉ]BEC)\s*$/i, "").trim();
  }
  return "";
}
