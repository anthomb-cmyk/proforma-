// proforma-web/src/components/SearchPackagePreview.jsx
//
// Dev-only modal that previews the search packages buildSearchPackages()
// would produce for a set of imported rows — BEFORE any paid lookup runs.
// Mounted only when the dev flag is on (see lib/searchPackageDebug.js).
//
// Pure presentational. All shape work lives in
// lib/searchPackageDebug.js#buildSearchPackagePreviewData so the tests can
// run without @testing-library/react.

import { useMemo, useState, useCallback, useEffect, useRef, Fragment } from "react";
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

// Stable key for deduplicating enriched packages across batches.
function makePackageKey(pkg) {
  return [
    String(pkg?.lead_owner_name || "").toLowerCase().trim(),
    String(pkg?.mailing_address || "").toLowerCase().trim(),
    String(pkg?.mailing_city || "").toLowerCase().trim(),
  ].join("|");
}

// Transform a single enrichment result into a candidatePhones entry for leads.
function enrichResultToCandidatePhone(r) {
  return {
    phone: r.bestPhone,
    source: "enrichment_web_search",
    phone_owner_name: r.bestPhoneBelongsTo || "",
    relationship_to_lead_owner: r.phoneRelationship || "enrichment",
    confidence: r.confidence || "low",
    evidence: (r.evidence || []).slice(-4).join(" | "),
    status: r.status,
  };
}

const BATCH_SIZES = [5, 10, 25, 50, 100];

export default function SearchPackagePreview({ rows, onClose, onExportToLeads, topN = 25 }) {
  const data = useMemo(
    () => buildSearchPackagePreviewData(rows, { topN }),
    [rows, topN],
  );

  const enrichEnabled = useMemo(() => isContactEnrichmentDebugEnabled(), []);

  // Batch size selector (5 / 10 / 25 / 50 / 100)
  const [batchSize, setBatchSize] = useState(5);

  // Run state for the active network call
  const [enrichState, setEnrichState] = useState(
    /** @type {"idle"|"loading"|"done"|"error"} */ "idle"
  );
  const [enrichError, setEnrichError] = useState(/** @type {string|null} */ null);

  // Progress UI state — ticks while a batch is running so the user gets
  // visible feedback (enrichment can take 30s+ per 5-package batch).
  const [enrichStartedAt, setEnrichStartedAt] = useState(/** @type {number|null} */ null);
  const [enrichElapsedMs, setEnrichElapsedMs] = useState(0);
  const enrichAbortRef = useRef(/** @type {AbortController|null} */ (null));

  // Session-level tracking — survives across multiple batches
  const [enrichedKeys, setEnrichedKeys] = useState(() => new Set());
  const [allEnrichedResults, setAllEnrichedResults] = useState(() => new Map());
  const [exportedKeys, setExportedKeys] = useState(() => new Set());

  // Most-recent batch tracking (for table display + re-run)
  const [currentBatch, setCurrentBatch] = useState(/** @type {object[]|null} */ null);
  const [currentBatchRange, setCurrentBatchRange] = useState(
    /** @type {{start:number,end:number}|null} */ null
  );
  const [currentBatchResults, setCurrentBatchResults] = useState(/** @type {object[]|null} */ null);

  // Export state
  const [exportState, setExportState] = useState(
    /** @type {"idle"|"loading"|"done"|"error"} */ "idle"
  );
  const [exportSummary, setExportSummary] = useState(/** @type {object|null} */ null);

  const allPkgs = data.topHighValueWithoutPhonePackages || [];
  const unenrichedPkgs = allPkgs.filter((p) => !enrichedKeys.has(makePackageKey(p)));
  const nextBatchPkgs = unenrichedPkgs.slice(0, batchSize);
  const hasAnyResults = allEnrichedResults.size > 0;

  // Core batch runner — uses functional setState to avoid stale closures.
  const runBatch = useCallback(async (batch) => {
    if (!batch?.length) return;
    // Abort any in-flight call before starting a new one (defensive: the
    // button is disabled during loading, but a stray double-click race is
    // possible and the existing controller would otherwise leak).
    if (enrichAbortRef.current) enrichAbortRef.current.abort();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    enrichAbortRef.current = controller;
    setEnrichState("loading");
    setEnrichError(null);
    setCurrentBatchResults(null);
    setEnrichStartedAt(Date.now());
    setEnrichElapsedMs(0);
    const res = await runContactEnrichmentPreview(batch, {
      limit: batch.length,
      signal: controller?.signal,
    });
    // Drop stale callbacks — only the latest controller is the live one.
    if (controller && enrichAbortRef.current !== controller) return;
    enrichAbortRef.current = null;
    if (res.ok) {
      setAllEnrichedResults((prev) => {
        const next = new Map(prev);
        batch.forEach((pkg, i) => next.set(makePackageKey(pkg), res.results[i]));
        return next;
      });
      setEnrichedKeys((prev) => {
        const next = new Set(prev);
        batch.forEach((pkg) => next.add(makePackageKey(pkg)));
        return next;
      });
      setCurrentBatchResults(res.results);
      setEnrichState("done");
    } else if (res.cancelled) {
      // User pressed Cancel — return to idle without surfacing an error.
      setEnrichState("idle");
    } else {
      setEnrichError(res.error || "Unknown error");
      setEnrichState("error");
    }
  }, []);

  // Cancel handler — aborts the in-flight fetch.
  const handleCancelEnrich = useCallback(() => {
    if (enrichAbortRef.current) {
      enrichAbortRef.current.abort();
      enrichAbortRef.current = null;
    }
    setEnrichState("idle");
  }, []);

  // Tick elapsed-time every 250ms while a batch is loading. Cleanup on
  // state change or unmount so the timer never leaks.
  useEffect(() => {
    if (enrichState !== "loading" || enrichStartedAt == null) return undefined;
    const id = setInterval(() => {
      setEnrichElapsedMs(Date.now() - enrichStartedAt);
    }, 250);
    return () => clearInterval(id);
  }, [enrichState, enrichStartedAt]);

  const handleEnrichNext = useCallback(() => {
    if (!nextBatchPkgs.length) return;
    // Count how many allPkgs are already enriched to compute the 1-based range.
    const doneCount = allPkgs.filter((p) => enrichedKeys.has(makePackageKey(p))).length;
    setCurrentBatch(nextBatchPkgs);
    setCurrentBatchRange({ start: doneCount + 1, end: doneCount + nextBatchPkgs.length });
    runBatch(nextBatchPkgs);
  }, [nextBatchPkgs, allPkgs, enrichedKeys, runBatch]);

  const handleRerunBatch = useCallback(() => {
    if (!currentBatch?.length) return;
    runBatch(currentBatch);
  }, [currentBatch, runBatch]);

  const handleExportToLeads = useCallback(async () => {
    if (!allEnrichedResults.size || typeof onExportToLeads !== "function") return;
    setExportState("loading");

    const readyUnexported = [...allEnrichedResults.entries()].filter(
      ([key, r]) => r.status === "ready_to_call" && !exportedKeys.has(key),
    );
    const allValues = [...allEnrichedResults.values()];
    const skippedReview = allValues.filter((r) => r.status === "needs_review").length;
    const skippedNoContact = allValues.filter(
      (r) => r.status === "no_contact_found" || r.status === "skipped_existing_phone",
    ).length;
    const skippedAlreadyExported = [...allEnrichedResults.entries()].filter(
      ([key, r]) => r.status === "ready_to_call" && exportedKeys.has(key),
    ).length;

    const exportRows = readyUnexported.map(([, r]) => ({
      companyName: r.lead_owner_name || "",
      mailing_address: r.mailing_address || "",
      mailing_city: r.mailing_city || "",
      phone: r.bestPhone || "",
      email: r.bestEmail || "",
      website: r.bestWebsite || "",
      candidatePhones: r.bestPhone ? [enrichResultToCandidatePhone(r)] : [],
      candidateEmails: r.bestEmail ? [{ email: r.bestEmail, source: "enrichment_web_search" }] : [],
      candidateWebsites: r.bestWebsite ? [{ website: r.bestWebsite, source: "enrichment_web_search" }] : [],
    }));

    try {
      const result = await Promise.resolve(onExportToLeads(exportRows, { ownerGrouped: false }));
      setExportedKeys((prev) => {
        const next = new Set(prev);
        readyUnexported.forEach(([key]) => next.add(key));
        return next;
      });
      setExportSummary({
        exported: readyUnexported.length,
        updated: result?.count ?? readyUnexported.length,
        skippedReview,
        skippedNoContact,
        skippedAlreadyExported,
      });
      setExportState("done");
    } catch (err) {
      setExportState("error");
      setExportSummary({ error: String(err?.message || err) });
    }
  }, [allEnrichedResults, exportedKeys, onExportToLeads]);

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
        {enrichEnabled && allPkgs.length > 0 && (
          <div style={{ ...card, padding: "12px 14px", marginTop: 12 }}>

            {/* Header row: title + batch size selector */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                Contact enrichment
                <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text3)", fontWeight: 500 }}>
                  dev only · web search
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text3)" }}>
                  Batch:&nbsp;
                  <select
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    disabled={enrichState === "loading"}
                    style={{ fontSize: 11, padding: "1px 4px" }}
                  >
                    {BATCH_SIZES.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Session progress bar */}
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>
                <strong style={{ color: enrichedKeys.size > 0 ? "var(--text)" : "var(--text3)" }}>
                  {enrichedKeys.size}
                </strong>{" "}enriched this session
              </span>
              <span>
                <strong style={{ color: "var(--text)" }}>{unenrichedPkgs.length}</strong>{" "}remaining
              </span>
              <span>next batch: <strong>{Math.min(nextBatchPkgs.length, batchSize)}</strong></span>
              {currentBatchRange && (
                <span style={{ color: "var(--accent)" }}>
                  current: {currentBatchRange.start}–{currentBatchRange.end}
                </span>
              )}
            </div>

            {/* Action buttons */}
            {enrichState !== "loading" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-sm"
                  onClick={handleEnrichNext}
                  disabled={!nextBatchPkgs.length}
                >
                  {hasAnyResults
                    ? `Enrich next ${nextBatchPkgs.length} target${nextBatchPkgs.length !== 1 ? "s" : ""}`
                    : `Enrich first ${nextBatchPkgs.length} target${nextBatchPkgs.length !== 1 ? "s" : ""}`}
                </button>
                {hasAnyResults && currentBatch?.length > 0 && (
                  <button
                    className="btn btn-sm"
                    style={{ color: "var(--text3)" }}
                    onClick={handleRerunBatch}
                  >
                    Re-run current batch ({currentBatch.length})
                  </button>
                )}
              </div>
            )}
            {enrichState === "loading" && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginBottom: 10,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg2, #fafafa)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    Enriching {currentBatch?.length || 0} package{(currentBatch?.length || 0) !== 1 ? "s" : ""}…
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleCancelEnrich}
                    style={{ color: "var(--text3)" }}
                    aria-label="Cancel enrichment"
                  >
                    Cancel
                  </button>
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    position: "relative",
                    height: 6,
                    borderRadius: 3,
                    overflow: "hidden",
                    background: "var(--border)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: "30%",
                      background: "var(--accent, #2563EB)",
                      borderRadius: 3,
                      animation: "pf-enrich-progress 1.4s ease-in-out infinite",
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", display: "flex", justifyContent: "space-between" }}>
                  <span>{(enrichElapsedMs / 1000).toFixed(1)}s elapsed</span>
                  <span>typically 30–90s for 5 packages — slower for large batches</span>
                </div>
                <style>{`@keyframes pf-enrich-progress { 0%{left:-30%} 50%{left:50%} 100%{left:100%} }`}</style>
              </div>
            )}

            {enrichState === "error" && (
              <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>
                Error: {enrichError}
              </div>
            )}

            {/* Current batch results table */}
            {enrichState === "done" && currentBatchResults && (
              currentBatchResults.length === 0
                ? <div style={{ fontSize: 12, color: "var(--text3)" }}>(no results in batch)</div>
                : <EnrichResultsTable results={currentBatchResults} />
            )}

            {!hasAnyResults && enrichState === "idle" && (
              <div style={{ fontSize: 11, color: "var(--text3)" }}>
                Requires <code>pf_websearch_debug=1</code> + backend env vars{" "}
                <code>WEB_SEARCH_PROVIDER</code> / <code>BRAVE_SEARCH_API_KEY</code>.
              </div>
            )}

            {/* Export — accumulates all session results, deduped */}
            {hasAnyResults && typeof onExportToLeads === "function" && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                {(() => {
                  const allVals = [...allEnrichedResults.values()];
                  const readyUnexportedCount = [...allEnrichedResults.entries()].filter(
                    ([key, r]) => r.status === "ready_to_call" && !exportedKeys.has(key),
                  ).length;
                  const alreadyExportedCount = [...allEnrichedResults.entries()].filter(
                    ([key, r]) => r.status === "ready_to_call" && exportedKeys.has(key),
                  ).length;
                  const reviewCount = allVals.filter((r) => r.status === "needs_review").length;
                  return (
                    <>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                        Session total: {allEnrichedResults.size} enriched
                        {alreadyExportedCount > 0 && ` · ${alreadyExportedCount} already exported`}
                        {reviewCount > 0 && ` · ${reviewCount} needs_review (skipped)`}
                      </div>
                      {exportState !== "done" && (
                        <button
                          className="btn btn-sm btn-gold"
                          onClick={handleExportToLeads}
                          disabled={exportState === "loading" || readyUnexportedCount === 0}
                        >
                          {exportState === "loading"
                            ? "Exporting…"
                            : `Export ${readyUnexportedCount} ready contact${readyUnexportedCount !== 1 ? "s" : ""} to Leads`}
                        </button>
                      )}
                      {exportState === "done" && exportSummary && !exportSummary.error && (
                        <div style={{ fontSize: 12, padding: "6px 10px", background: "#DCFCE7", borderRadius: 6, color: "#166534" }}>
                          Exported {exportSummary.exported} contact{exportSummary.exported !== 1 ? "s" : ""} to Leads
                          {exportSummary.skippedReview > 0 && ` · ${exportSummary.skippedReview} needs_review skipped`}
                          {exportSummary.skippedNoContact > 0 && ` · ${exportSummary.skippedNoContact} no-contact skipped`}
                          {exportSummary.skippedAlreadyExported > 0 && ` · ${exportSummary.skippedAlreadyExported} already exported`}
                        </div>
                      )}
                      {exportState === "error" && exportSummary?.error && (
                        <div style={{ fontSize: 12, color: "#B91C1C" }}>
                          Export error: {exportSummary.error}
                        </div>
                      )}
                    </>
                  );
                })()}
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
