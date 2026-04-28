// proforma-web/src/components/ReviewQueue.jsx
//
// Thin presentational component over reviewQueueLogic.js. Renders a list of
// needs_review / ready_to_email packages with Accept / Reject / Skip buttons
// per row.

import { useMemo } from "react";
import {
  filterReviewableEntries,
  pickPrimaryCandidate,
} from "../lib/reviewQueueLogic.js";

const STATUS_COLORS = {
  needs_review: { background: "#FEF9C3", color: "#854D0E" },
  ready_to_email: { background: "#DBEAFE", color: "#1E40AF" },
  accepted: { background: "#DCFCE7", color: "#166534" },
  rejected: { background: "#FEE2E2", color: "#991B1B" },
  skipped: { background: "#F3F4F6", color: "#6B7280" },
};

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

  if (!items.length) {
    return (
      <div style={{ fontSize: 12, color: "var(--text3)", padding: 12, textAlign: "center" }}>
        Nothing in the review queue. Items with status <code>needs_review</code> or <code>ready_to_email</code> appear here as they're enriched.
      </div>
    );
  }

  return (
    <div>
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
          {items.map(({ packageKey, result, decision }) => {
            const cand = pickPrimaryCandidate(result);
            return (
              <tr key={packageKey}>
                <td style={cellStyle({ fontWeight: 600 })}>{result.lead_owner_name || "—"}</td>
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
                <td style={{ ...cellStyle({ textAlign: "right" }), whiteSpace: "nowrap" }}>
                  <button className="btn btn-sm" onClick={() => onAccept?.(packageKey, cand)} disabled={decision === "accepted"}
                    style={{ marginLeft: 4 }}>Accept</button>
                  <button className="btn btn-sm" onClick={() => onReject?.(packageKey, cand)} disabled={decision === "rejected"}
                    style={{ marginLeft: 4, color: "var(--text3)" }}>Reject</button>
                  <button className="btn btn-sm" onClick={() => onSkip?.(packageKey)}
                    style={{ marginLeft: 4, color: "var(--text3)" }}>Skip</button>
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
