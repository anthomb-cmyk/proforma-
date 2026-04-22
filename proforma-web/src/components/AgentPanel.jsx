import { useState, useEffect, useCallback, useRef } from "react";

// ─── Date / format helpers ────────────────────────────────────────────────────

function torontoDatePlusDays(n) {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(d);
}

function torontoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

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

function fmtBlob(dateStr, timeStr) {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    const datePart = new Intl.DateTimeFormat("fr-CA", {
      weekday: "short", day: "numeric", month: "short"
    }).format(dt);
    return timeStr ? `${datePart} à ${timeStr}` : datePart;
  } catch {
    return dateStr;
  }
}

function relativeOverdue(utcStr) {
  if (!utcStr) return "";
  const diffDays = Math.floor((Date.now() - new Date(utcStr).getTime()) / 86400000);
  if (diffDays <= 0) return "aujourd'hui";
  if (diffDays === 1) return "hier";
  return `${diffDays} jours de retard`;
}

// Normalize shortExplanation for known edge cases.
function normalizeExplanation(text) {
  const lo = (text || "").toLowerCase();
  if (lo.includes("no pending") || lo.includes("aucun suivi")) {
    return "Aucun suivi actif pour ce deal.";
  }
  return text;
}

// ─── Preset buttons ───────────────────────────────────────────────────────────

const DEAL_PRESETS = [
  { label: "Demain 9h",         source: "preset:tomorrow_9am",  intent: () => "créer follow-up demain à 9h"                    },
  { label: "Dans 3 jours",      source: "preset:3_days",        intent: () => `créer follow-up ${torontoDatePlusDays(3)} à 9h` },
  { label: "Semaine prochaine", source: "preset:next_week",     intent: () => "créer follow-up lundi à 9h"                    },
  { label: "Terminer ✓",        source: "preset:complete",      intent: () => "complete the follow-up"                        },
  { label: "Annuler ✗",         source: "preset:cancel",        intent: () => "cancel the follow-up"                          },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusLine({ deal, localFollowUpAt }) {
  if (!deal) return null;
  const muted  = { fontSize: 12, color: "var(--muted, #888)",      marginBottom: 10 };
  const normal = { fontSize: 12, color: "var(--fg, #333)",         marginBottom: 10 };
  const amber  = { fontSize: 12, color: "var(--orange, #e67e22)", fontWeight: 500, marginBottom: 10 };

  if (localFollowUpAt === "") {
    return <div style={muted}>Aucun suivi planifié</div>;
  }
  if (localFollowUpAt) {
    const overdue = new Date(localFollowUpAt) < new Date();
    const label   = fmtUtc(localFollowUpAt);
    return overdue
      ? <div style={amber}>⚠ En retard — {label}</div>
      : <div style={normal}>Suivi : {label}</div>;
  }
  if (deal.followUpDate) {
    const overdue = deal.followUpDate < torontoToday();
    const label   = fmtBlob(deal.followUpDate, deal.followUpTime);
    return overdue
      ? <div style={amber}>⚠ En retard — {label}</div>
      : <div style={normal}>Suivi : {label}</div>;
  }
  return <div style={muted}>Aucun suivi planifié</div>;
}

// GCal sync status badge — shown below mutation results only.
function GCalBadge({ hadToken, warning }) {
  if (!hadToken) {
    return (
      <div style={{ fontSize: 11, color: "var(--muted, #888)", marginTop: 4 }}>
        ○ GCal non connecté
      </div>
    );
  }
  if (warning) {
    const msg = /401|token|expired/i.test(warning)
      ? "Session Google Calendar expirée — reconnectez-vous."
      : warning;
    return (
      <div style={{ fontSize: 11, color: "var(--red, #c0392b)", marginTop: 4 }}>
        🔴 GCal non synchronisé — {msg}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 11, color: "var(--muted, #888)", marginTop: 4 }}>
      📅 Synchronisé avec Google Calendar
    </div>
  );
}

function MutationResult({ result }) {
  const VERB = {
    create:     "Suivi créé",
    reschedule: "Suivi reporté",
    complete:   "Suivi complété",
    cancel:     "Suivi annulé",
  };
  const verb  = VERB[result.actionTaken] || result.actionTaken;
  const dueAt = result.followUpChanges?.due_at;
  const label = dueAt && (result.actionTaken === "create" || result.actionTaken === "reschedule")
    ? `${verb} — ${fmtUtc(dueAt)}`
    : verb;
  return (
    <div style={{ fontSize: 13, color: "var(--fg, #333)", marginTop: 4 }}>
      ✓ {label}
    </div>
  );
}

function OverdueList({ items }) {
  if (!Array.isArray(items)) return null;
  if (items.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--fg, #333)", marginTop: 4 }}>Aucun suivi en retard ✓</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {items.map(row => (
        <div key={row.id} style={{ padding: "6px 8px", background: "var(--bg-alt, #f5f5f5)", borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>{row.dealName || row.deal_id}</strong>
            <span style={{ fontSize: 11, color: "var(--red, #c0392b)", fontWeight: 600 }}>
              {relativeOverdue(row.due_at)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted, #888)", marginTop: 2 }}>{fmtUtc(row.due_at)}</div>
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
  const [localFollowUpAt, setLocalFollowUpAt] = useState(null);
  const [hadToken,       setHadToken]       = useState(false);
  const fadeTimerRef = useRef(null);

  useEffect(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setResult(null);
    setFetchError("");
    setLocalFollowUpAt(null);
  }, [deal?.id]);

  const effectiveDealId = deal?.id || dealIdOverride.trim() || null;

  const fire = useCallback(async (intentStr, source = "freetext") => {
    const trimmed = (intentStr || "").trim();
    if (!trimmed) return;

    // Cancel any pending success-fade before starting a new request.
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    const gcalToken = localStorage.getItem("socle_gcal_token") || null;
    setHadToken(!!gcalToken);
    setLoading(true);
    setResult(null);
    setFetchError("");

    try {
      const body = { intent: trimmed, dealId: effectiveDealId, source };
      if (gcalToken) body.gcalToken = gcalToken;

      const res  = await fetch("/api/agent/action", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok) {
        setFetchError(normalizeExplanation(data?.shortExplanation || data?.error || `Erreur ${res.status}`));
      } else {
        setResult(data);

        // Update local status line immediately (parent won't refresh without reload).
        if (data.actionTaken === "create" || data.actionTaken === "reschedule") {
          setLocalFollowUpAt(data.followUpChanges?.due_at || null);
        } else if (data.actionTaken === "complete" || data.actionTaken === "cancel") {
          setLocalFollowUpAt("");
        }

        // Auto-fade successful mutations after 4 s; errors and overdue list stay.
        const isMutation = ["create", "reschedule", "complete", "cancel"].includes(data.actionTaken);
        const isSuccess  = isMutation && data.followUpChanges !== null;
        if (isSuccess) {
          fadeTimerRef.current = setTimeout(() => {
            setResult(null);
            fadeTimerRef.current = null;
          }, 4000);
        }
      }
    } catch {
      setFetchError("Impossible de contacter le serveur.");
    } finally {
      setLoading(false);
    }
  }, [effectiveDealId]);

  function handleSubmit(e) {
    e.preventDefault();
    fire(intent, "freetext");
  }

  // A mutation response with followUpChanges === null signals an engine-level error.
  const isMutationError = result?.followUpChanges === null &&
    ["create", "reschedule", "complete", "cancel"].includes(result?.actionTaken);
  const isError    = result?.actionTaken === "none" || isMutationError;
  const isOverdue  = result?.actionTaken === "show_overdue";
  const isMutation = !isError && !isOverdue && result !== null;

  return (
    <div className="card f-card">
      <div className="f-title">Agent IA — Suivi</div>

      {/* Deal context */}
      <div style={{ marginBottom: 4, fontSize: 12, color: "var(--muted, #888)" }}>
        {deal
          ? <>Deal actif : <strong>{deal.title || deal.address || deal.id}</strong></>
          : <span style={{ color: "var(--red, #c0392b)" }}>Aucun deal sélectionné</span>
        }
      </div>

      {/* Current follow-up status line */}
      <StatusLine deal={deal} localFollowUpAt={localFollowUpAt} />

      {/* Manual dealId override */}
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
            onClick={() => fire(p.intent(), p.source)}
          >
            {p.label}
          </button>
        ))}
        <button
          className="btn"
          style={{ fontSize: 12, padding: "4px 10px" }}
          disabled={loading}
          onClick={() => fire("show overdue", "preset:show_overdue")}
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

      {/* Hint: no dealId */}
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

      {/* Result */}
      {result && (
        <div style={{ marginTop: 4 }}>
          {isError ? (
            <div style={{ fontSize: 13, color: "var(--red, #c0392b)" }}>
              ⚠ {normalizeExplanation(result.shortExplanation)}
              {(result.shortExplanation || "").toLowerCase().includes("dealid") && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Sélectionnez un deal ou entrez un Deal ID pour cette action.
                </div>
              )}
            </div>
          ) : isOverdue ? (
            <OverdueList items={result.followUpChanges} />
          ) : isMutation ? (
            <>
              <MutationResult result={result} />
              <GCalBadge hadToken={hadToken} warning={result.warning} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
