// services/sourceQualityClassifier.js
//
// Classify a web search result by the nature of its source.
// Used in contactEnrichmentPipeline to gate which results can contribute
// phone/email candidates at ready_to_call / ready_to_email confidence.
//
// Input:  { url, title, snippet }
// Output: { quality, reasons[] }
//
// quality values (in priority order — first match wins):
//   "company_profile" — corporate registry / B2BHint / OpenCorporates
//   "government"      — government / municipal site → reject
//   "junk"            — mail stores, social media, couriers → reject
//   "directory"       — listing directory (pages jaunes, 411, Yelp…) → allow with nameMatch
//   "real_estate"     — property-management / real-estate company → allow
//   "private_business"— general business website → allow

// ─── Pattern sets ──────────────────────────────────────────────────────────

const COMPANY_PROFILE_DOMAINS = [
  /b2bhint\.com/i,
  /registreentreprises\.gouv\.qc\.ca/i,
  /opencorporates\.com/i,
  /judiciaire\.justice\.gouv\.qc\.ca/i,
  /ic\.gc\.ca.*CorporationsCanada/i,
  /infogreffe\.fr/i,
];

const GOVERNMENT_DOMAINS = [
  /\.gouv\.qc\.ca/i,
  /\.gc\.ca/i,
  /\.canada\.ca/i,
  /ville\.[a-z-]+\.(qc\.)?ca/i,
  /mairie\.[a-z-]+\.ca/i,
  /mrc\.[a-z-]+\.ca/i,
  /agglomeration\.[a-z-]+\.ca/i,
];

const DIRECTORY_DOMAINS = [
  /pagesjaunes\.ca/i,
  /yellowpages\.\w+/i,
  /canada411\.ca/i,
  /(?<!\.)411\.ca/i,
  /yelp\.(ca|com)/i,
  /tripadvisor\.(ca|com)/i,
  /cylex\.ca/i,
  /n49\.ca/i,
  /toile\.ca/i,
  /showmelocal\.com/i,
];

const JUNK_DOMAINS = [
  /facebook\.com/i,
  /linkedin\.com/i,
  /twitter\.com/i,
  /instagram\.com/i,
  /tiktok\.com/i,
  /youtube\.com/i,
  /canadapost\.ca/i,
  /purolator\.com/i,
  /fedex\.com/i,
  /ups\.com/i,
  /dhl\.com/i,
];

const JUNK_TITLE_RE =
  /\b(?:ups\s+store|purolator|fedex|dhl|canada\s+post|postes?\s+canada|courrier|courier|mailbox(?:es)?|mail\s+box|boite\s+postale|bo[iî]te\s+postale|packing\s+store|shipping\s+store|regus|servcorp|coworking|virtual\s+office|bureau\s+virtuel)\b/i;

const REAL_ESTATE_RE =
  /\b(?:immobili[eè]re?|immobilier|gestion\s+immobili[eè]re?|gestion\s+locative|location\s+immobili[eè]re?|property\s+management|appartements?\s+[àa]\s+louer|logements?\s+[àa]\s+louer|propri[eé]t[eé]s?\s+[àa]\s+vendre|realty|real\s+estate|gestionnaire\s+immobilier|investissements?\s+immobiliers?)\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────

function matchesDomain(url, patterns) {
  const u = String(url || "");
  return patterns.some((re) => re.test(u));
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Classify a search result by source quality.
 *
 * @param {{ url?: string, title?: string, snippet?: string }} result
 * @returns {{ quality: string, reasons: string[] }}
 */
export function classifySource({ url, title, snippet } = {}) {
  const u = String(url || "");
  const t = String(title || "");
  const s = String(snippet || "");
  const combined = `${t} ${s}`;
  const reasons = [];

  // 1. Company profile registries (before government check — registre is .gouv.qc.ca).
  if (matchesDomain(u, COMPANY_PROFILE_DOMAINS)) {
    reasons.push("company_profile_domain");
    return { quality: "company_profile", reasons };
  }

  // 2. Government / municipal.
  if (matchesDomain(u, GOVERNMENT_DOMAINS)) {
    reasons.push("government_domain");
    return { quality: "government", reasons };
  }

  // 3. Junk title signals (mail/courier stores).
  if (JUNK_TITLE_RE.test(t)) {
    reasons.push("junk_title");
    return { quality: "junk", reasons };
  }

  // 4. Junk domains (social networks, couriers).
  if (matchesDomain(u, JUNK_DOMAINS)) {
    reasons.push("junk_domain");
    return { quality: "junk", reasons };
  }

  // 5. Listing directories.
  if (matchesDomain(u, DIRECTORY_DOMAINS)) {
    reasons.push("directory_domain");
    return { quality: "directory", reasons };
  }

  // 6. Real-estate keyword in title or snippet.
  if (REAL_ESTATE_RE.test(combined)) {
    reasons.push("real_estate_keyword");
    return { quality: "real_estate", reasons };
  }

  // Default: private business website.
  reasons.push("private_business_default");
  return { quality: "private_business", reasons };
}

/**
 * Returns true when the quality allows the result to contribute a
 * ready_to_call / ready_to_email phone/email candidate (before name matching).
 */
export function isAllowedSource(quality) {
  return quality === "private_business"
    || quality === "real_estate"
    || quality === "company_profile"
    || quality === "directory";
}

/**
 * Returns true when the quality must cause the result to be rejected outright
 * (before any phone/email extraction attempts).
 */
export function isRejectedSource(quality) {
  return quality === "government" || quality === "junk";
}
