import { useState, useEffect, useCallback } from "react";

// ─── Date / format helpers ────────────────────────────────────────────────────

function torontoDatePlusDays(n) {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(d);
}

// Toronto today as YYYY-MM-DD (for overdue comparison with blob date strings).
function torontoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

// Format a UTC ISO string → short French date+time in Toronto timezone.
// e.g. "mar. 30 avr. à 9 h 00"
function fmtUtc(utcStr) {
  if (!utcStr) return "";
  try {
    return new Date(utcStr).toLocaleString("fr-CA", {
      timeZone: "America/Toronto",
      weekday: "short", day: "numeric", month: "short",
      hour: "numeric", minute: "2-digit"
    });
  } catch {
    return utcStr;
  }
}

// Format blob date+time fields (already Toronto local, e.g. "2026-04-30" / "09:00").
// Constructs a UTC noon date to avoid browser-timezone day-shift, then formats.
function fmtBlob(dateStr, timeStr) {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC — safe for any browser TZ
    const datePart = new Intl.DateTimeFormat("fr-CA", {
      weekday: "short", day: "numeric", month: "short"
    }).format(dt);
    return timeStr ? `${datePart} à ${timeStr}` : datePart;
  } catch {
    return dateStr;
  }
}

// Relative label for an overdue UTC timestamp: "aujourd'hui", "hier", "N jours de retard".
function relativeOverdue(utcStr) {
  if (!utcStr) return "";
  const diffMs   = Date.now() - new Date(utcStr).getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays <= 0) return "aujourd'hui";
  if (diffDays === 1) return "hier";
  return `${diffDays} jours de retard`;
}

// ─── Preset buttons ───────────────────────────────────────────────────────────

const DEAL_PRESETS = [
  { label: "Demain 9h",         intent: () => "créer follow-up demain à 9h"                     },
  { label: "Dans 3 jours",      intent: () => `créer follow-up ${torontoDatePlusDays(3)} à 9h`  },
  { label: "Semaine prochaine", intent: () => "créer follow-up lundi à 9h"                      },
  { label: "Terminer ✓",        intent: () => "complete the follow-up"                           },
  { label: "Annuler ✗",         intent: () => "cancel the follow-up"                             },
];

// ─── Status line (3C) ─────────────────────────────────────────────────────────

function StatusLine({ deal, localFollowUpAt }) {
  if (!deal) return null;

  // localFollowUpAt: null = use deal prop; "" = explicitly cleared; UTC ISO = override.
  let content;
  const muted  = { fontSize: 12, color: "var(--muted, #888)", marginBottom: 10 };
  const normal = { fontSize: 12, color: "var(--fg, #333)",    marginBottom: 10 };
  const amber  = { fontSize: 12, color: "var(--orange, #e67e22)", fontWeight: 500, marginBottom: 10 };

  if (localFollowUpAt === "") {
    // Cleared by complete/cancel.
    content = <div style={muted}>Aucun suivi planifié</div>;
  } else if (localFollowUpAt) {
    // Set by create/reschedule — UTC ISO from API.
    const overdue  = new Date(localFollowUpAt) < new Date();
    const label    = fmtUtc(localFollowUpAt);
    content = overdue
      ? <div style={amber}>⚠ En retard — {label}</div>
      : <div style={normal}>Suivi : {label}</div>;
  } else if (deal.followUpDate) {
    // From blob via deal prop.
    const today   = torontoToday();
    const overdue = deal.followUpDate < today;
    const label   = fmtBlob(deal.followUpDate, deal.followUpTime);
    content = overdue
      ? <div style={amber}>⚠ En retard — {label}</div>
      : <div style={normal}>Suivi : {label}</div>;
  } else {
    content = <div style={muted}>Aucun suivi planifié</div>;
  }

  return content;
}

// ─── Result display (3B) ──────────────────────────────────────────────────────

function MutationResult({ result }) {
  const { actionTaken, followUpChanges, warning } = result;

  const VERB = {
    create:     "Suivi créé",
    reschedule: "Suivi reporté",
    complete:   "Suivi complété",
    cancel:     "Suivi annulé",
  };

  const verb   = VERB[actionTaken] || actionTaken;
  const dueAt  = followUpChanges?.due_at;
  const label  = dueAt && (actionTaken === "create" || actionTaken === "reschedule")
    ? `${verb} — ${fmtUtc(dueAt)}`
    : verb;

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 13, color: "var(--fg, #333)", marginBottom: warning ? 4 : 0 }}>
        ✓ {label}
      </div>
      {warning ? (
        <div style={{ fontSize: 12, color: "var(--orange, #e67e22)" }}>
          ⚠ {warning}
        </div>
      ) : dueAt && (actionTaken === "create" || actionTaken === "reschedule") ? (
        <div style={{ fontSize: 11, color: "var(--muted, #888)" }}>
          📅 Calendrier synchronisé
        </div>
      ) : null}
    </div>
  );
}

function OverdueList({ items }) {
  if (!Array.isArray(items)) return null;
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--fg, #333)", marginTop: 4 }}>
        Aucun suivi en retard ✓
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {items.map(row => (
        <div key={row.id} style={{
          padding: "6px 8px",
          background: "var(--bg-alt, #f5f5f5)", borderRadius: 4
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>{row.dealName || row.deal_id}</strong>
            <span style={{ fontSize: 11, color: "var(--red, #c0392b)", fontWeight: 600 }}>
              {relativeOverdue(row.due_at)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted, #888)", marginTop: 2 }}>
            {fmtUtc(row.due_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentPanel({ deal }) {
  const [intent,         setIntent]         = useState("");
  const [dealIdOverride, setDealIdOverride] = useState("");
  const [loading,        setLoading]        = useState(false);
  const [result,         setResult]         = useState(null);
  const [fetchError,     setFetchError]     = useState("");
  // null = read from deal prop; "" = cleared; UTC ISO = post-action override.
  const [localFollowUpAt, setLocalFollowUpAt] = useState(null);

  // Clear everything when the selected deal changes.
  useEffect(() => {
    setResult(null);
    setFetchError("");
    setLocalFollowUpAt(null);
  }, [deal?.id]);

  const effectiveDealId = deal?.id || dealIdOverride.trim() || null;

  const fire = useCallback(async (intentStr) => {
    const trimmed = (intentStr || "").trim();
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
        // 3C: update local status line after mutation (deal prop won't refresh without reload).
        if (data.actionTaken === "create" || data.actionTaken === "reschedule") {
          setLocalFollowUpAt(data.followUpChanges?.due_at || null);
        } else if (data.actionTaken === "complete" || data.actionTaken === "cancel") {
          setLocalFollowUpAt("");
        }
      }
    } catch (err) {
      setFetchError(err?.message || "Requête échouée.");
    } finally {
      setLoading(false);
    }
  }, [effectiveDealId]);

  function handleSubmit(e) {
    e.preventDefault();
    fire(intent);
  }

  const isError = result?.actionTaken === "none";

  return (
    <div className="card f-card">
      <div className="f-title">Agent IA — Suivi</div>

      {/* Deal context + status line (3C) */}
      <div style={{ marginBottom: 4, fontSize: 12, color: "var(--muted, #888)" }}>
        {deal
          ? <>Deal actif : <strong>{deal.title || deal.address || deal.id}</strong></>
          : <span style={{ color: "var(--red, #c0392b)" }}>Aucun deal sélectionné</span>
        }
      </div>
      <StatusLine deal={deal} localFollowUpAt={localFollowUpAt} />

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

      {/* Quick action presets */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {deal && DEAL_PRESETS.map(p => (
          <button
            key={p.label}
            className="btn"
            style={{ fontSize: 12, padding: "4px 10px" }}
            disabled={loading}
            onClick={() => fire(p.intent())}
          >
            {p.label}
          </button>
        ))}
        <button
          className="btn"
          style={{ fontSize: 12, padding: "4px 10px" }}
          disabled={loading}
          onClick={() => fire("show overdue")}
        >
          Voir en retard
        </button>
      </div>

      {/* Custom intent input */}
      <div style={{ fontSize: 11, color: "var(--muted, #888)", marginBottom: 4 }}>
        Action personnalisée
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            type="text"
            placeholder="Ex : créer follow-up vendredi à 14h · reporter à mardi"
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
          Les actions globales (voir en retard) fonctionnent sans deal.
          Pour créer / modifier un suivi, sélectionnez un deal.
        </div>
      )}

      {/* Fetch-level error */}
      {fetchError && (
        <div style={{ color: "var(--red, #c0392b)", fontSize: 12, marginBottom: 8 }}>
          ⚠ {fetchError}
        </div>
      )}

      {/* Result (3B) */}
      {result && (
        <div style={{ marginTop: 4 }}>
          {isError ? (
            <div style={{ fontSize: 13, color: "var(--red, #c0392b)" }}>
              ⚠ {result.shortExplanation}
              {result.shortExplanation?.toLowerCase().includes("dealid") && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Sélectionnez un deal ou entrez un Deal ID pour cette action.
                </div>
              )}
            </div>
          ) : result.actionTaken === "show_overdue" ? (
            <OverdueList items={result.followUpChanges} />
          ) : (
            <MutationResult result={result} />
          )}
        </div>
      )}
    </div>
  );
}
