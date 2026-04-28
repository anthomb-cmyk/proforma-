// proforma-web/src/components/ReviewQueue.jsx
//
// Thin presentational component over reviewQueueLogic.js. Renders a list of
// needs_review / ready_to_email packages with Accept / Reject / Skip buttons
// per row.

import { useMemo, useState } from "react";
import {
  filterReviewableEntries,
  pickPrimaryCandidate,
  computeReviewSignals,
} from "../lib/reviewQueueLogic.js";

const STATUS_COLORS = {
  needs_review: { background: "#FEF9C3", color: "#854D0E" },
  ready_to_email: { background: "#DBEAFE", color: "#1E40AF" },
  accepted: { background: "#DCFCE7", color: "#166534" },
  rejected: { background: "#FEE2E2", color: "#991B1B" },
  skipped: { background: "#F3F4F6", color: "#6B7280" },
};

const SIGNAL_COLORS = {
  positive: { background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" },
  negative: { background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5" },
  neutral:  { background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #93C5FD" },
};

const RECOMMENDATION_STYLES = {
  accept: { color: "#166534", fontWeight: 600 },
  reject: { color: "#991B1B", fontWeight: 600 },
  verify: { color: "#92400E", fontWeight: 600 },
};

function SignalBadge({ signal }) {
  const style = SIGNAL_COLORS[signal.kind] || SIGNAL_COLORS.neutral;
  return (
    <span style={{
      ...style,
      borderRadius: 4,
      padding: "1px 5px",
      fontSize: 9,
      fontWeight: 600,
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
      whiteSpace: "nowrap",
    }}>
      {signal.icon} {signal.text}
    </span>
  );
}

function Pill({ label }) {
  const c = STATUS_COLORS[label] || STATUS_COLORS.skipped;
  return (
    <span style={{ ...c, borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 600 }}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default function ReviewQueue({
  allEnrichedResults,
  reviewDecisions,
  onAccept,
  onReject,
  onSkip,
  onForceReenrich,
  showAccepted = false,
  showRejected = false,
}) {
  const items = useMemo(
    () => filterReviewableEntries(
      [...(allEnrichedResults || new Map()).entries()],
      reviewDecisions || new Map(),
      { includeAccepted: showAccepted, includeRejected: showRejected },
    ),
    [allEnrichedResults, reviewDecisions, showAccepted, showRejected],
  );

  // Compute signals for all items upfront (needed for filter counts)
  const itemsWithSignals = useMemo(
    () => items.map((item) => ({
      ...item,
      ...computeReviewSignals(item.result),
    })),
    [items],
  );

  // Quick filter state: 'all' | 'accept' | 'reject'
  const [quickFilter, setQuickFilter] = useState("all");

  const filteredItems = useMemo(() => {
    if (quickFilter === "all") return itemsWithSignals;
    return itemsWithSignals.filter((item) => item.recommendation === quickFilter);
  }, [itemsWithSignals, quickFilter]);

  const acceptCount = useMemo(() => itemsWithSignals.filter((i) => i.recommendation === "accept").length, [itemsWithSignals]);
  const rejectCount = useMemo(() => itemsWithSignals.filter((i) => i.recommendation === "reject").length, [itemsWithSignals]);

  if (!items.length) {
    return (
      <div style={{ fontSize: 12, color: "var(--text3)", padding: 12, textAlign: "center" }}>
        Nothing in the review queue. Items with status <code>needs_review</code> or <code>ready_to_email</code> appear here as they're enriched.
      </div>
    );
  }

  return (
    <div>
      {/* Quick-filter bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {[
          { key: "all", label: `Show all (${itemsWithSignals.length})` },
          { key: "accept", label: `Show recommended Accept (${acceptCount})` },
          { key: "reject", label: `Show recommended Reject (${rejectCount})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setQuickFilter(key)}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: quickFilter === key ? "var(--accent, #4F46E5)" : "var(--surface, #FFFDF7)",
              color: quickFilter === key ? "#fff" : "var(--text3)",
              cursor: "pointer",
              fontWeight: quickFilter === key ? 700 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
        {items.length} item{items.length !== 1 ? "s" : ""} in review.
        Accept promotes to <code>ready_to_call</code>; Reject adds the candidate to the never-call list; Skip leaves it for later.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text3)" }}>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Owner</th>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Status</th>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Phone</th>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Belongs to</th>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Source</th>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Evidence (top)</th>
            <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
              Decision
            </th>
            {onForceReenrich && <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}></th>}
          </tr>
        </thead>
        <tbody>
          {filteredItems.map(({ packageKey, result, decision, signals, recommendation }) => {
            const cand = pickPrimaryCandidate(result);
            const recStyle = RECOMMENDATION_STYLES[recommendation] || RECOMMENDATION_STYLES.verify;
            const recLabel = recommendation === "accept"
              ? "Accept recommended"
              : recommendation === "reject"
              ? "Reject recommended"
              : "Verify";
            return (
              <tr key={packageKey}>
                <td style={cellStyle({ fontWeight: 600, verticalAlign: "top" })}>
                  <div>{result.lead_owner_name || "—"}</div>
                  {signals.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                      {signals.map((s, i) => <SignalBadge key={i} signal={s} />)}
                    </div>
                  )}
                </td>
                <td style={cellStyle()}>
                  <Pill label={decision || result.status} />
                </td>
                <td style={cellStyle({ fontFamily: "monospace" })}>{cand?.raw || "—"}</td>
                <td style={cellStyle({ color: "var(--text2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                  {result.bestPhoneBelongsTo || cand?.belongsTo || "—"}
                </td>
                <td style={cellStyle({ color: "var(--text3)" })}>{cand?.relationship || result.phoneRelationship || "—"}</td>
                <td style={cellStyle({ color: "var(--text3)", fontSize: 10, fontFamily: "monospace", maxWidth: 320, overflow: "hidden" })}>
                  {(result.evidence || []).slice(-2).join(" | ") || "—"}
                </td>
                <td style={{ ...cellStyle({ textAlign: "right" }), whiteSpace: "nowrap", verticalAlign: "top" }}>
                  <div style={{ marginBottom: 4, ...recStyle, fontSize: 9 }}>{recLabel}</div>
                  <div>
                    <button
                      className="btn btn-sm"
                      onClick={() => onAccept?.(packageKey, cand)}
                      disabled={decision === "accepted" || (!cand && !result.bestEmail)}
                      title={!cand && !result.bestEmail ? "No phone or email — nothing to accept" : undefined}
                      style={{ marginLeft: 4 }}
                    >
                      Accept
                    </button>
                    <button className="btn btn-sm" onClick={() => onReject?.(packageKey, cand)} disabled={decision === "rejected"}
                      style={{ marginLeft: 4, color: "var(--text3)" }}>Reject</button>
                    <button className="btn btn-sm" onClick={() => onSkip?.(packageKey)}
                      style={{ marginLeft: 4, color: "var(--text3)" }}>Skip</button>
                  </div>
                </td>
                {onForceReenrich && (
                  <td style={cellStyle()}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ fontSize: 9, color: "var(--text3)", padding: "1px 4px" }}
                      onClick={() => onForceReenrich?.(result)}
                      title="Clear cache and re-enrich"
                    >
                      Re-enrich
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function cellStyle(extra = {}) {
  return { padding: "6px 6px", borderBottom: "1px solid var(--border)", ...extra };
}
