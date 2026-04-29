import { useState, useEffect } from "react";

/**
 * Shows the honest result of a direct-import operation. Renders nothing
 * when no result is available.
 *
 * @param {object} props
 * @param {{ added: number, updated: number, skipped: number, totalSent: number, at: number } | null} props.result
 * @param {() => void} props.onDismiss
 * @param {() => void} props.onViewLeads  Called when user clicks "View Leads".
 * @param {string} [props.lang]  "fr" | "en"
 */
export default function DirectImportResultCard({ result, onDismiss, onViewLeads, lang = "fr" }) {
  if (!result) return null;
  const { added = 0, updated = 0, skipped = 0, totalSent = 0 } = result;

  // Determine messaging tier:
  //   success     — added > 0
  //   neutral     — added=0 but updated>0 (existing leads got new info)
  //   warning     — added=0 && updated=0 && skipped>0 (nothing landed)
  //   info        — totalSent=0 (caller passed an empty result; shouldn't happen)
  const tier =
    added > 0 ? "success"
    : updated > 0 ? "neutral"
    : skipped > 0 ? "warning"
    : "info";

  const styleMap = {
    success: { bg: "#DCFCE7", border: "#86EFAC", color: "#166534" },
    neutral: { bg: "#DBEAFE", border: "#93C5FD", color: "#1E40AF" },
    warning: { bg: "#FEF3C7", border: "#FCD34D", color: "#92400E" },
    info:    { bg: "var(--bg2,#fafafa)", border: "var(--border)", color: "var(--text2)" },
  };
  const s = styleMap[tier];

  // Headline text per tier.
  const headline = (() => {
    if (lang === "en") {
      if (tier === "success") return `Direct import complete — ${added} new lead${added !== 1 ? "s" : ""} added`;
      if (tier === "neutral") return `0 new leads created — ${updated} existing lead${updated !== 1 ? "s" : ""} updated`;
      if (tier === "warning") return `No leads added or updated — ${skipped} row${skipped !== 1 ? "s" : ""} skipped`;
      return "Direct import complete";
    }
    if (tier === "success") return `Importation terminée — ${added} nouveau${added !== 1 ? "x" : ""} lead${added !== 1 ? "s" : ""} ajouté${added !== 1 ? "s" : ""}`;
    if (tier === "neutral") return `Aucun nouveau lead créé — ${updated} lead${updated !== 1 ? "s" : ""} existant${updated !== 1 ? "s" : ""} mis à jour`;
    if (tier === "warning") return `Aucun lead ajouté ou mis à jour — ${skipped} ligne${skipped !== 1 ? "s" : ""} ignorée${skipped !== 1 ? "s" : ""}`;
    return "Importation terminée";
  })();

  const detail = lang === "en"
    ? `${totalSent} sent · ${added} new · ${updated} updated · ${skipped} skipped`
    : `${totalSent} envoyées · ${added} ajoutées · ${updated} mises à jour · ${skipped} ignorées`;

  const explainer = (() => {
    if (tier !== "neutral") return null;
    return lang === "en"
      ? "Your Leads count may not increase — the importer matched these rows to existing leads (same owner / same address) and updated them in place."
      : "Le compteur de Leads peut ne pas augmenter — l'importateur a fait correspondre ces lignes à des leads existants (même propriétaire / même adresse) et les a mis à jour sur place.";
  })();

  return (
    <div role="status" aria-live="polite" style={{
      padding: "12px 14px",
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 8,
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: s.color, fontSize: 13 }}>{headline}</div>
          <div style={{ fontSize: 11, color: s.color, marginTop: 4, opacity: 0.9 }}>{detail}</div>
          {explainer && (
            <div style={{ fontSize: 11, color: s.color, marginTop: 6, opacity: 0.85 }}>{explainer}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {typeof onViewLeads === "function" && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onViewLeads}
              style={{ fontSize: 11 }}
            >
              {lang === "en" ? "View Leads" : "Voir Leads"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={onDismiss}
            aria-label="Dismiss"
            style={{ fontSize: 11, color: "var(--text3)" }}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
