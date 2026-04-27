// proforma-web/src/components/SearchPackagePreview.jsx
//
// Dev-only modal that previews the search packages buildSearchPackages()
// would produce for a set of imported rows — BEFORE any paid lookup runs.
// Mounted only when the dev flag is on (see lib/searchPackageDebug.js).
//
// Pure presentational. All shape work lives in
// lib/searchPackageDebug.js#buildSearchPackagePreviewData so the tests can
// run without @testing-library/react.

import { useMemo, useState, useCallback, Fragment } from "react";
import { buildSearchPackagePreviewData } from "../lib/searchPackageDebug.js";
import {
  isContactEnrichmentDebugEnabled,
  runContactEnrichmentPreview,
} from "../lib/contactEnrichmentPreview.js";
import { CloseIcon } from "./Icons.jsx";

const cellLabel = { fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 };
const cellValue = { fontSize: 18, fontWeight: 700, color: "var(--text)" };
const subValue = { fontSize: 12, color: "var(--text2)", marginTop: 2 };
const card = {
  background: "var(--surface, #FFFDF7)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
};

function StatTile({ label, value, sub }) {
  return (
    <div style={card}>
      <div style={cellLabel}>{label}</div>
      <div style={cellValue}>{value}</div>
      {sub ? <div style={subValue}>{sub}</div> : null}
    </div>
  );
}

function Bucket({ entries }) {
  // entries: [[key, count], …]
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {entries.map(([k, v]) => (
        <span key={k} style={{
          background: "#EEF2FF", color: "#3730A3", borderRadius: 6,
          padding: "2px 8px", fontSize: 11, fontWeight: 600,
        }}>{k}={v}</span>
      ))}
    </div>
  );
}

// Status badge styling
const STATUS_COLORS = {
  ready_to_call: { background: "#DCFCE7", color: "#166534" },
  needs_review: { background: "#FEF9C3", color: "#854D0E" },
  ready_to_email: { background: "#DBEAFE", color: "#1E40AF" },
  no_contact_found: { background: "#F3F4F6", color: "#6B7280" },
  skipped_existing_phone: { background: "#F3F4F6", color: "#6B7280" },
};

function StatusBadge({ status }) {
  const style = STATUS_COLORS[status] || STATUS_COLORS.no_contact_found;
  return (
    <span style={{
      ...style,
      borderRadius: 4,
      padding: "2px 6px",
      fontSize: 10,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>{status?.replace(/_/g, " ")}</span>
  );
}

const TD = ({ children, style }) => (
  <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", ...style }}>{children}</td>
);

// Enrichment results table with per-row expandable evidence panel.
function EnrichResultsTable({ results }) {
  const [openIdx, setOpenIdx] = useState(null);
  const toggle = useCallback((i) => setOpenIdx((prev) => (prev === i ? null : i)), []);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--text3)" }}>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", width: 16 }} />
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Owner</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Status</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Best phone</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Belongs to</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Src</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Email</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Website</th>
          <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Conf.</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r, i) => (
          <Fragment key={i}>
            <tr style={{ cursor: "pointer" }} onClick={() => toggle(i)}>
              <TD style={{ color: "var(--text3)", userSelect: "none" }}>
                {openIdx === i ? "▼" : "▶"}
              </TD>
              <TD style={{ fontWeight: 600, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.lead_owner_name || "—"}
              </TD>
              <TD><StatusBadge status={r.status} /></TD>
              <TD style={{ fontFamily: "monospace" }}>{r.bestPhone || "—"}</TD>
              <TD style={{ color: "var(--text2)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.bestPhoneBelongsTo || "—"}
              </TD>
              <TD style={{ color: "var(--text3)" }}>{r.phoneRelationship || "—"}</TD>
              <TD style={{ color: "var(--text2)" }}>{r.bestEmail || "—"}</TD>
              <TD style={{ color: "var(--text2)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.bestWebsite
                  ? <a href={r.bestWebsite} target="_blank" rel="noopener noreferrer"
                      style={{ color: "var(--accent)" }}
                      onClick={(e) => e.stopPropagation()}>{r.bestWebsite}</a>
                  : "—"}
              </TD>
              <TD style={{ color: "var(--text3)" }}>{r.confidence || "—"}</TD>
            </tr>

            {openIdx === i && (
              <tr>
                <td colSpan={9} style={{ padding: "6px 12px 10px 28px", borderBottom: "1px solid var(--border)", background: "var(--surface2, #F9F9F7)" }}>
                  {/* Evidence log */}
                  <div style={{ marginBottom: 4, fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Evidence
                  </div>
                  {(r.evidence || []).length === 0
                    ? <div style={{ fontSize: 11, color: "var(--text3)" }}>(none)</div>
                    : (r.evidence || []).map((line, j) => (
                        <div key={j} style={{
                          fontSize: 10, fontFamily: "monospace",
                          color: line.startsWith("rejected") || line.startsWith("skipped") ? "#B91C1C"
                               : line.startsWith("best_phone") ? "#166534"
                               : line.startsWith("low_confidence") ? "#854D0E"
                               : "var(--text2)",
                          marginBottom: 1,
                        }}>{line}</div>
                      ))}

                  {/* All phone candidates */}
                  {(r.phoneCandidates || []).length > 0 && (
                    <>
                      <div style={{ marginTop: 6, marginBottom: 2, fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                        All phone candidates ({r.phoneCandidates.length})
                      </div>
                      {r.phoneCandidates.map((c, k) => (
                        <div key={k} style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text2)", marginBottom: 1 }}>
                          {c.raw} · src={c.source} · score={c.score ?? "?"} · nameMatch={String(c.nameMatch)} · from="{c.belongsTo}"
                        </div>
                      ))}
                    </>
                  )}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export default function SearchPackagePreview({ rows, onClose, topN = 25 }) {
  const data = useMemo(
    () => buildSearchPackagePreviewData(rows, { topN }),
    [rows, topN],
  );

  const enrichEnabled = useMemo(() => isContactEnrichmentDebugEnabled(), []);

  const [enrichState, setEnrichState] = useState(
    /** @type {"idle"|"loading"|"done"|"error"} */ "idle"
  );
  const [enrichResults, setEnrichResults] = useState(/** @type {object[]|null} */ null);
  const [enrichError, setEnrichError] = useState(/** @type {string|null} */ null);

  const handleEnrich = useCallback(async () => {
    const pkgs = data.topHighValueWithoutPhonePackages;
    if (!pkgs?.length) return;
    setEnrichState("loading");
    setEnrichError(null);
    const res = await runContactEnrichmentPreview(pkgs, { limit: Math.min(pkgs.length, 5) });
    if (res.ok) {
      setEnrichResults(res.results);
      setEnrichState("done");
    } else {
      setEnrichError(res.error || "Unknown error");
      setEnrichState("error");
    }
  }, [data.topHighValueWithoutPhonePackages]);

  return (
    <div className="mo" onClick={onClose}>
      <div
        className="mo-box"
        style={{ maxWidth: 880, width: "94vw", maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="mo-title" style={{ marginBottom: 0 }}>
            Search-package preview
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>
              dev only · no API call
            </span>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            <CloseIcon size={11} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 10 }}>
          {data.inputRowCount} input rows → <strong>{data.packageCount}</strong> packages
        </div>

        {/* Top stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
          <StatTile label="Total packages" value={data.packageCount} />
          <StatTile label="With phone" value={data.withPhone}
            sub={`owner-direct: ${data.withOwnerFilePhone}`} />
          <StatTile label="Without phone" value={data.withoutPhone} />
          <StatTile label="Numbered companies" value={data.numberedCompanies} />
          <StatTile label="Trusts / fiducies" value={data.trusts} />
          <StatTile label="Same-name diff. address" value={data.duplicateDifferentAddress}
            sub="informational" />
        </div>

        {/* Lead value / search need / enrichment priority */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={card}>
            <div style={cellLabel}>Lead value</div>
            <Bucket entries={[
              ["high", data.leadValue.high],
              ["medium", data.leadValue.medium],
              ["low", data.leadValue.low],
            ]} />
          </div>
          <div style={card}>
            <div style={cellLabel}>Search need</div>
            <Bucket entries={[
              ["high", data.searchNeed.high],
              ["medium", data.searchNeed.medium],
              ["low", data.searchNeed.low],
              ["skip", data.searchNeed.skip],
            ]} />
          </div>
          <div style={card}>
            <div style={cellLabel}>Enrichment priority</div>
            <Bucket entries={[
              ["high", data.highPriorityTargets ?? 0],
              ["med", data.mediumPriorityTargets ?? 0],
              ["low", data.lowPriorityTargets ?? 0],
              ["skip", data.skippedUnsearchable ?? 0],
              ["✓", data.alreadyHasPhone ?? 0],
            ]} />
          </div>
        </div>

        {/* Top high-value owners without any phone */}
        <div style={{ ...card, padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              Top {Math.min(topN, data.topHighValueWithoutPhone.length)} search-priority targets without phone
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>
              sorted by enrichment score (high → medium → low)
            </div>
          </div>
          {data.topHighValueWithoutPhone.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>(none)</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text3)" }}>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>#</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Owner</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Category</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Score</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Enrich</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Strategy</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Props</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Units</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Mailing</th>
                </tr>
              </thead>
              <tbody>
                {data.topHighValueWithoutPhone.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>{i + 1}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{row.name}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>{row.category}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "monospace" }}>{row.enrichmentScore}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", color: row.enrichmentPriority === "high" ? "#166534" : row.enrichmentPriority === "medium" ? "#854D0E" : "var(--text3)" }}>{row.enrichmentPriority}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>{row.strategy}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{row.properties}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{row.units || "—"}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--text2)" }}>
                      {[row.mailingAddress, row.mailingCity].filter(Boolean).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Contact-enrichment preview (pf_websearch_debug flag) ─────────── */}
        {enrichEnabled && data.topHighValueWithoutPhonePackages?.length > 0 && (
          <div style={{ ...card, padding: "12px 14px", marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                Contact enrichment
                <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text3)", fontWeight: 500 }}>
                  dev only · web search
                </span>
              </div>
              {enrichState !== "loading" && (
                <button
                  className="btn btn-sm"
                  onClick={handleEnrich}
                  disabled={enrichState === "loading"}
                >
                  {enrichState === "idle"
                    ? `Test enrichment on top ${Math.min(data.topHighValueWithoutPhonePackages.length, 5)} search-priority targets`
                    : "Re-run enrichment"}
                </button>
              )}
              {enrichState === "loading" && (
                <span style={{ fontSize: 11, color: "var(--text3)" }}>Running…</span>
              )}
            </div>

            {enrichState === "error" && (
              <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>
                Error: {enrichError}
              </div>
            )}

            {enrichState === "done" && enrichResults && (
              enrichResults.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>(no results)</div>
              ) : (
                <EnrichResultsTable results={enrichResults} />
              )
            )}

            {enrichState === "idle" && (
              <div style={{ fontSize: 11, color: "var(--text3)" }}>
                Requires <code>pf_websearch_debug=1</code> + backend env vars{" "}
                <code>WEB_SEARCH_PROVIDER</code> / <code>BRAVE_SEARCH_API_KEY</code>.
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 11, color: "var(--text3)" }}>
          To toggle this preview: <code>localStorage.setItem("pf_spdebug", "1")</code> · refresh
        </div>
      </div>
    </div>
  );
}
