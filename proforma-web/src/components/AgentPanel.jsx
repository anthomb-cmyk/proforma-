import { useState } from "react";

// Format a UTC timestamptz string into a short local date+time label.
function fmtDue(due_at) {
  if (!due_at) return "";
  try {
    return new Date(due_at).toLocaleString("fr-CA", {
      timeZone: "America/Toronto",
      dateStyle: "short",
      timeStyle: "short"
    });
  } catch {
    return due_at;
  }
}

const ACTION_LABELS = {
  create:       "Créé",
  reschedule:   "Reporté",
  complete:     "Complété",
  cancel:       "Annulé",
  show_overdue: "En retard",
  none:         "Aucune action",
};

export default function AgentPanel({ deal }) {
  const [intent,         setIntent]         = useState("");
  const [dealIdOverride, setDealIdOverride] = useState("");
  const [loading,        setLoading]        = useState(false);
  const [result,         setResult]         = useState(null);
  const [fetchError,     setFetchError]     = useState("");

  const effectiveDealId = deal?.id || dealIdOverride.trim() || null;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = intent.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    setFetchError("");
    try {
      const gcalToken = localStorage.getItem("socle_gcal_token") || null;
      const body = { intent: trimmed, dealId: effectiveDealId };
      if (gcalToken) body.gcalToken = gcalToken;

      const res = await fetch("/api/agent/action", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data?.shortExplanation || data?.error || `Erreur ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setFetchError(err?.message || "Requête échouée.");
    } finally {
      setLoading(false);
    }
  }

  const needsDealId = result?.actionTaken === "none" &&
    result?.shortExplanation?.toLowerCase().includes("dealid");

  return (
    <div className="card f-card">
      <div className="f-title">Agent IA — Suivi</div>

      {/* Deal context */}
      <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted, #888)" }}>
        {deal
          ? <>Deal actif : <strong>{deal.name || deal.id}</strong></>
          : <span style={{ color: "var(--red, #c0392b)" }}>Aucun deal sélectionné</span>
        }
      </div>

      {/* Manual dealId override — only shown when no deal is selected */}
      {!deal && (
        <div style={{ marginBottom: 10 }}>
          <input
            type="text"
            placeholder="Deal ID (optionnel pour actions globales)"
            value={dealIdOverride}
            onChange={e => setDealIdOverride(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </div>
      )}

      {/* Intent input + submit */}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            placeholder="Ex : créer follow-up demain à 14h · show overdue · complete the follow-up"
            value={intent}
            onChange={e => setIntent(e.target.value)}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            className="btn btn-gold"
            disabled={loading || !intent.trim()}
          >
            {loading ? "…" : "Envoyer"}
          </button>
        </div>
      </form>

      {/* Hint: mutation without a dealId */}
      {!effectiveDealId && (
        <div style={{ fontSize: 11, color: "var(--muted, #888)", marginBottom: 8 }}>
          Les actions globales (show overdue) fonctionnent sans deal.
          Pour créer / modifier un suivi, sélectionnez un deal.
        </div>
      )}

      {/* Fetch-level error */}
      {fetchError && (
        <div style={{ color: "var(--red, #c0392b)", fontSize: 12, marginBottom: 8 }}>
          {fetchError}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 4 }}>
          {/* Action badge + explanation */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              background: result.actionTaken === "none" ? "var(--red, #c0392b)" : "var(--gold, #b8920a)",
              color: "#fff"
            }}>
              {ACTION_LABELS[result.actionTaken] || result.actionTaken}
            </span>
            <span style={{ fontSize: 13 }}>{result.shortExplanation}</span>
          </div>

          {/* GCal warning */}
          {result.warning && (
            <div style={{ fontSize: 12, color: "var(--orange, #e67e22)", marginBottom: 6 }}>
              ⚠ {result.warning}
            </div>
          )}

          {/* "dealId required" inline error */}
          {needsDealId && (
            <div style={{ fontSize: 12, color: "var(--red, #c0392b)", marginBottom: 6 }}>
              Sélectionnez un deal ou entrez un Deal ID pour cette action.
            </div>
          )}

          {/* show_overdue list */}
          {result.actionTaken === "show_overdue" && Array.isArray(result.followUpChanges) && (
            <div style={{ marginTop: 6 }}>
              {result.followUpChanges.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>Aucun suivi en retard.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {result.followUpChanges.map(row => (
                    <div key={row.id} style={{
                      display: "flex", justifyContent: "space-between",
                      fontSize: 12, padding: "4px 8px",
                      background: "var(--bg-alt, #f5f5f5)", borderRadius: 4
                    }}>
                      <span style={{ fontWeight: 500 }}>
                        {row.dealName || row.deal_id}
                      </span>
                      <span style={{ color: "var(--red, #c0392b)" }}>
                        {fmtDue(row.due_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
