// proforma-web/src/components/EnrichmentDashboard.jsx
//
// Phase 5.1.1 — Unified import dashboard shown above the data after a file
// is loaded. Pure presentational: all decision logic lives in the caller
// (PhoneFinder.jsx). No API calls.
//
// The Brave-call estimate constants below are kept in sync with the backend
// pipeline in services/contactEnrichmentPipeline.js:
//   MAX_DIRECT_QUERIES          = 3
//   MAX_ADDRESS_DISCOVERY_QUERIES = 4
//   MAX_PROFILE_EXPANSION_QUERIES = 3
//   Total per package           = 10  (we use 10 for a conservative estimate;
//                                      real max is 3+4+3+some name-variant
//                                      extras — stays under 13 per package)
// If those constants change in the backend, update BRAVE_QUERIES_PER_PACKAGE.
const BRAVE_QUERIES_PER_PACKAGE = 10; // synced with backend pipeline constants
const PLACES_MISS_RATE_ESTIMATE = 0.30; // 30 % of eligible rows fall back to Places
const PLACES_COST_PER_CALL = 0.05;     // ~$0.05 per Places lookup

/**
 * Unified enrichment dashboard card.
 *
 * @param {object} props
 * @param {string}   props.fileName
 * @param {number}   props.totalRows
 * @param {number}   props.rowsWithPhone          - already have phone in file
 * @param {number}   props.rowsEligibleForEnrichment - no phone, can be enriched
 * @param {number}   props.rowsSkipped            - residential / insufficient
 * @param {Function} props.onDirectImport         - import phones-in-file → Leads
 * @param {Function} props.onEnrichMissing         - open new pipeline panel
 * @param {Function} props.onUseLegacy             - open old Google Places dialog
 * @param {boolean}  [props.estimatedCostBraveSubscription=false]
 * @param {number}   [props.estimatedCostPlacesPerMiss=0.05]
 * @param {number}   [props.estimatedCostLegacy=0]
 * @param {number}   [props.importedCount=0]       - rows marked imported this session
 * @param {boolean}  [props.allWithPhoneImported=false] - all phone-rows already imported
 * @param {boolean}  [props.postImportMode=false]  - swap CTA emphasis after successful import
 */
export default function EnrichmentDashboard({
  fileName,
  totalRows,
  rowsWithPhone,
  rowsEligibleForEnrichment,
  rowsSkipped,
  onDirectImport,
  onEnrichMissing,
  onUseLegacy,
  estimatedCostBraveSubscription = false,
  estimatedCostPlacesPerMiss = PLACES_COST_PER_CALL,
  estimatedCostLegacy = 0,
  importedCount = 0,
  allWithPhoneImported = false,
  postImportMode = false,
}) {
  // ── Cost estimate ────────────────────────────────────────────────────────
  const eligible = Number.isFinite(rowsEligibleForEnrichment)
    ? rowsEligibleForEnrichment
    : 0;
  const braveCallsEstimate = eligible * BRAVE_QUERIES_PER_PACKAGE;
  const estimatedMisses = Math.round(eligible * PLACES_MISS_RATE_ESTIMATE);
  const placesFallbackCostLow = 0;
  const placesFallbackCostHigh = estimatedMisses * (estimatedCostPlacesPerMiss || PLACES_COST_PER_CALL);
  const placesFallbackCostWorstCase = eligible * (estimatedCostPlacesPerMiss || PLACES_COST_PER_CALL);

  const fmt = (n) => {
    if (!Number.isFinite(n)) return "$0";
    if (n === 0) return "$0";
    if (n < 1) return `$${n.toFixed(2)}`;
    return `$${Math.round(n)}`;
  };

  // ── Shared style tokens ──────────────────────────────────────────────────
  const card = {
    background: "var(--card, #FFFDF7)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "16px 18px",
    marginBottom: 14,
  };

  const sectionTitle = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "var(--text3)",
    marginBottom: 8,
  };

  const statRow = {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 4,
  };

  const statNumber = (color = "var(--text)") => ({
    fontSize: 22,
    fontWeight: 700,
    color,
    minWidth: 46,
    textAlign: "right",
    flexShrink: 0,
  });

  const statLabel = {
    fontSize: 13,
    color: "var(--text2)",
    lineHeight: 1.3,
  };

  const btn = {
    display: "block",
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
    border: "1px solid",
    marginBottom: 8,
    lineHeight: 1.3,
  };

  const btnGold = {
    ...btn,
    background: "var(--gold-light, #FFF4DD)",
    borderColor: "var(--gold, #D4A017)",
    color: "var(--text)",
  };

  const btnBlue = {
    ...btn,
    background: "#EBF3FF",
    borderColor: "#A8C8F5",
    color: "#1A4C8A",
  };

  const btnGhost = {
    ...btn,
    background: "transparent",
    borderColor: "var(--border)",
    color: "var(--text3)",
    fontSize: 12,
    fontWeight: 600,
  };

  const costBox = {
    background: "#F3F9EE",
    border: "1px solid #C5E3AE",
    borderRadius: 8,
    padding: "10px 14px",
    marginTop: 4,
    fontSize: 12,
    lineHeight: 1.6,
    color: "#2D6A1A",
  };

  const costBoxLegacy = {
    background: "#FEF9EC",
    border: "1px solid #F5E5B0",
    borderRadius: 8,
    padding: "8px 12px",
    marginTop: 2,
    fontSize: 11,
    color: "#7A5E00",
  };

  return (
    <div style={card}>
      {/* File summary */}
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--text3)" }}>Fichier : </span>
        <strong style={{ fontSize: 13, color: "var(--text)" }}>{fileName || "—"}</strong>
        <span style={{ fontSize: 13, color: "var(--text3)", marginLeft: 8 }}>
          · {totalRows ?? 0} lignes importées
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* ── Left column: status breakdown ──────────────────────────────── */}
        <div>
          <div style={sectionTitle}>Statut</div>

          <div style={statRow}>
            <div style={statNumber("#1A7A3F")}>{rowsWithPhone ?? 0}</div>
            <div style={statLabel}>
              ont déjà un téléphone dans le fichier
              {/* PR #38.4: show imported sub-line if any were imported this session */}
              {importedCount > 0 && (
                <div style={{ fontSize: 11, color: "#1A7A3F", marginTop: 2, opacity: 0.85 }}>
                  ↳ {importedCount} déjà importé{importedCount !== 1 ? "s" : ""} dans Leads ce session
                </div>
              )}
            </div>
          </div>

          <div style={statRow}>
            <div style={statNumber("var(--gold, #D4A017)")}>{rowsEligibleForEnrichment ?? 0}</div>
            <div style={statLabel}>sans téléphone — éligibles à l'enrichissement</div>
          </div>

          {(rowsSkipped ?? 0) > 0 && (
            <div style={statRow}>
              <div style={statNumber("var(--text3)")}>{rowsSkipped}</div>
              <div style={statLabel}>résidentiels / données insuffisantes — ignorés</div>
            </div>
          )}
        </div>

        {/* ── Right column: actions ───────────────────────────────────────── */}
        <div>
          <div style={sectionTitle}>Actions</div>

          {/* PR #38.5: after a successful import, swap CTA emphasis:
               - Enrich becomes primary (gold)
               - Direct import becomes secondary (blue / ghost) */}
          {/* Action 2: enrich missing phones via the new pipeline */}
          <button
            style={postImportMode ? btnGold : btnBlue}
            onClick={onEnrichMissing}
            disabled={!(rowsEligibleForEnrichment > 0)}
            title="Ouvrir le panneau d'enrichissement Brave Search + Places"
          >
            Enrichir {rowsEligibleForEnrichment ?? 0} téléphones manquants
            <div style={{ fontSize: 11, fontWeight: 500, color: postImportMode ? "var(--text3)" : "#4A7FB0", marginTop: 2 }}>
              Nouveau pipeline Brave Search · coût réduit
            </div>
          </button>

          {/* Action 1: direct import of rows that already have a phone */}
          <button
            style={postImportMode ? btnGhost : btnGold}
            onClick={onDirectImport}
            disabled={!(rowsWithPhone > 0)}
            title="Importer directement les lignes qui ont déjà un numéro — aucun appel API"
          >
            {allWithPhoneImported
              ? `Ré-importer ${rowsWithPhone ?? 0} → Leads`
              : `Importer ${rowsWithPhone ?? 0} téléphones (déjà au fichier) → Leads`}
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)", marginTop: 2 }}>
              Aucun coût API · zéro appel réseau
            </div>
          </button>

          {/* Action 3: legacy escape hatch */}
          <button
            style={btnGhost}
            onClick={onUseLegacy}
            title="Utiliser l'ancien flux Google Places (confirmation séparée)"
          >
            Utiliser l'ancien flux Google Places →
          </button>
        </div>
      </div>

      {/* ── Cost estimate block ─────────────────────────────────────────── */}
      <div style={{ marginTop: 12 }}>
        <div style={sectionTitle}>Estimation du coût (nouveau pipeline)</div>

        <div style={costBox}>
          <div>
            <strong>Brave Search : ~{braveCallsEstimate.toLocaleString()} requêtes</strong>
            {estimatedCostBraveSubscription
              ? " · incluses dans l'abonnement (coût : $0)"
              : " · vérifiez votre quota Brave"}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Fallback Google Places : ~{fmt(placesFallbackCostLow)}–{fmt(placesFallbackCostHigh)}</strong>
            {" "}(estimé ~{Math.round(PLACES_MISS_RATE_ESTIMATE * 100)} % d'échecs ×{" "}
            {fmt(estimatedCostPlacesPerMiss || PLACES_COST_PER_CALL)}/appel · uniquement si la case est cochée)
          </div>
          <div style={{ marginTop: 4, fontWeight: 700, color: "#1A5C00" }}>
            Total estimé : {fmt(placesFallbackCostLow)}–{fmt(placesFallbackCostHigh)} typique
            · max {fmt(placesFallbackCostWorstCase)} si chaque ligne passe par Places
          </div>
        </div>

        {estimatedCostLegacy > 0 && (
          <div style={costBoxLegacy}>
            Ancien flux Google Places : ~{fmt(estimatedCostLegacy)} pour {eligible} lignes
            {" "}— l'estimation ci-dessus représente{" "}
            {estimatedCostLegacy > 0
              ? `${Math.round((1 - placesFallbackCostHigh / estimatedCostLegacy) * 100)}% d'économies potentielles`
              : "une réduction significative des coûts"}
          </div>
        )}
      </div>
    </div>
  );
}
