// services/companyProfileExtractor.js
//
// Detect corporate-registry / B2BHint / OpenCorporates results and extract
// structured company data from URL + title + snippet WITHOUT making additional
// HTTP requests.
//
// A company profile result provides:
//   • Director / officer names → co-owner match expansion
//   • Related companies at the same address → follow-up queries
//   • Enterprise number (NEQ) → targeted registry lookup
//   • Legal address → corroboration of mailing address
//
// IMPORTANT: A profile page WITHOUT an extracted phone is evidence + expansion
// targets only — NOT a contact result. Callers must not promote a profile URL
// to ready_to_call unless a phone was extracted from title/snippet.

// ─── Profile source detection ─────────────────────────────────────────────

const PROFILE_DOMAIN_RE =
  /(?:b2bhint\.com|registreentreprises\.gouv\.qc\.ca|opencorporates\.com|judiciaire\.justice\.gouv\.qc\.ca|ic\.gc\.ca.*CorporationsCanada)/i;

export function isCompanyProfileUrl(url) {
  return PROFILE_DOMAIN_RE.test(String(url || ""));
}

// ─── Enterprise number (NEQ) extraction ─────────────────────────────────

// Québec NEQ: 10 digits (optionally formatted with dashes/spaces).
const NEQ_RE = /\b(\d{4}[-\s]\d{4}[-\s]\d{2}|\d{10})\b/;

function extractEnterpriseNumber(text) {
  const m = String(text || "").match(NEQ_RE);
  if (!m) return "";
  return m[1].replace(/[-\s]/g, "");
}

// ─── Company name from title ─────────────────────────────────────────────

// B2BHint:      "Gestion X Inc. – B2BHint"  /  "Gestion X Inc. | B2BHint"
// Registre QC:  "Registre des entreprises du Québec – Gestion X Inc."
// OpenCorp:     "GESTION X INC · OpenCorporates"
function extractCompanyNameFromTitle(title) {
  return String(title || "")
    .replace(/\s*[-|·–—]\s*(?:b2bhint|opencorporates|registre\s+des\s+entreprises.*?)[\s\S]*$/i, "")
    .replace(/^(?:registre\s+des\s+entreprises\s+(?:du\s+)?qu[eé]bec\s*[-–—]\s*)/i, "")
    .trim();
}

// ─── Director / officer extraction ──────────────────────────────────────

// B2BHint snippet patterns:
//   "Dirigeants: Jean Dupont, Marie Martin"
//   "Administrateurs: Jean Dupont • Marie Martin"
//   "Director: John Smith"
//   "Président: Jean Dupont | Secrétaire: Marie Martin"
const DIRECTORS_LABEL_RE =
  /(?:dirigeants?|administrateurs?|directors?|officers?|pr[eé]sidents?|secr[eé]taires?|associ[eé]s?)\s*[:\-–]\s*/gi;

function extractPeople(snippet) {
  const s = String(snippet || "");
  const people = [];

  let m;
  const re = new RegExp(
    "(?:dirigeants?|administrateurs?|directors?|officers?|pr[eé]sidents?|secr[eé]taires?|associ[eé]s?)\\s*[:\\-–]\\s*([^.\\n]+)",
    "gi",
  );
  while ((m = re.exec(s)) !== null) {
    const raw = m[1];
    const parts = raw
      .split(/[,;•·|]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3 && p.length <= 60 && /[a-zA-ZÀ-ÿ]/.test(p));
    people.push(...parts);
  }

  return [...new Set(people)];
}

// ─── Legal address extraction ────────────────────────────────────────────

const ADDRESS_LABEL_RE =
  /(?:adresse(?:\s+civique)?|si[eè]ge\s+social|address|adresse\s+l[eé]gale)\s*[:\-–]\s*/i;

function extractLegalAddress(snippet) {
  const m = String(snippet || "").match(
    new RegExp(ADDRESS_LABEL_RE.source + "([^.\\n]{5,100})", "i"),
  );
  return m ? m[1].trim() : "";
}

// ─── Business activity ────────────────────────────────────────────────────

const ACTIVITY_LABEL_RE =
  /(?:activit[eé]s?|secteur(?:\s+d'activit[eé])?|industry|naics|scian|domaine)\s*[:\-–]\s*/i;

function extractActivity(snippet) {
  const m = String(snippet || "").match(
    new RegExp(ACTIVITY_LABEL_RE.source + "([^.\\n]{2,80})", "i"),
  );
  return m ? m[1].trim() : "";
}

// ─── Related companies ───────────────────────────────────────────────────

const RELATED_LABEL_RE =
  /(?:entreprises?\s+li[eé]es?|related\s+compan(?:y|ies)|compagnies?\s+li[eé]es?|soci[eé]t[eé]s?\s+li[eé]es?)\s*[:\-–]\s*/i;

function extractRelatedCompanies(snippet) {
  // Match the label and capture everything until newline. Periods inside the
  // capture (e.g. "Inc.") are tolerated; trailing sentence punctuation is
  // trimmed in post-processing.
  const m = String(snippet || "").match(
    new RegExp(RELATED_LABEL_RE.source + "([^\\n]{3,300})", "i"),
  );
  if (!m) return [];
  return m[1]
    .replace(/\.$/, "") // drop trailing sentence period
    .split(/[,;•·]+/)
    .map((s) => s.trim().replace(/\.$/, "").trim())
    .filter((s) => s.length >= 3 && s.length <= 80 && /[a-zA-ZÀ-ÿ]/.test(s));
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Extract structured company data from a single search result.
 * Returns null when the URL is not a company profile source.
 *
 * @param {{ url: string, title: string, snippet: string }} result
 * @returns {{ companyName, enterpriseNumber, legalAddress, activity,
 *             directors[], officers[], relatedCompanies[], sourceUrl } | null}
 */
export function extractCompanyProfile(result) {
  if (!result || !isCompanyProfileUrl(result.url)) return null;

  const combined = `${result.title || ""} ${result.snippet || ""}`;

  return {
    companyName: extractCompanyNameFromTitle(result.title || ""),
    enterpriseNumber: extractEnterpriseNumber(combined),
    legalAddress: extractLegalAddress(result.snippet || ""),
    activity: extractActivity(result.snippet || ""),
    directors: extractPeople(result.snippet || ""),
    officers: [],
    relatedCompanies: extractRelatedCompanies(result.snippet || ""),
    sourceUrl: result.url || "",
  };
}

/**
 * Build expansion queries from an extracted company profile.
 * Each director and related company gets a query anchored at the mailing address.
 * The enterprise number, when present, generates a registry lookup query.
 *
 * @param {object} profile          From extractCompanyProfile
 * @param {string} [mailingAddress] "street, city, province" anchor
 * @returns {string[]}              De-duplicated query list
 */
export function buildProfileExpansionQueries(profile, mailingAddress) {
  if (!profile) return [];
  const addr = String(mailingAddress || "").trim();
  const seen = new Set();
  const out = [];

  const push = (q) => {
    const k = q.toLowerCase().trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(q.trim());
    }
  };

  for (const dir of profile.directors || []) {
    if (!dir) continue;
    if (addr) push(`"${dir}" ${addr}`);
    else push(`"${dir}" Québec immobilier gestion`);
  }

  for (const rel of profile.relatedCompanies || []) {
    if (!rel) continue;
    if (addr) push(`"${rel}" ${addr}`);
    else push(rel);
  }

  if (profile.enterpriseNumber) {
    push(`NEQ ${profile.enterpriseNumber} registre entreprises Québec`);
  }

  return out;
}
