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
  deriveSessionId,
  loadSession,
  saveSession,
  clearSession,
} from "../lib/enrichmentSession.js";
import {
  markNeverCall,
} from "../lib/neverCallList.js";
import {
  applyAcceptedDecision,
  summarizeSession,
} from "../lib/reviewQueueLogic.js";
import ReviewQueue from "./ReviewQueue.jsx";
import {
  isContactEnrichmentDebugEnabled,
  runContactEnrichmentPreview,
} from "../lib/contactEnrichmentPreview.js";
import {
  runEnrichmentOrchestrator,
  postEnrichmentSingle,
} from "../lib/enrichmentOrchestrator.js";
import {
  groupPackagesByOwner,
  fanOutResult,
} from "../lib/ownerDeduplication.js";
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

  // Per-package mode: uses orchestrator + owner dedup instead of batch preview
  const [perPkgMode, setPerPkgMode] = useState(true);
  // Concurrency for the orchestrator (1–5, default 3)
  const [concurrency, setConcurrency] = useState(3);
  // Dedup toast shown once per session
  const [dedupToast, setDedupToast] = useState(/** @type {string|null} */ null);
  // Per-package progress tracking: how many of the representatives completed
  const [pkgDone, setPkgDone] = useState(0);
  const [pkgTotal, setPkgTotal] = useState(0);
  // Orchestrator abort controller ref (separate from batch abort)
  const orchAbortRef = useRef(/** @type {AbortController|null} */ (null));

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

  // ─── Phase 1: auto-advance / pause-resume / persistence / review queue ───

  // Active tab in the enrichment panel: 'batch' | 'review'.
  const [activeTab, setActiveTab] = useState(/** @type {"batch"|"review"} */ "batch");
  // Auto-advance kicks off the next batch when the current one finishes.
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [paused, setPaused] = useState(false);
  // Per-package decisions made in the review queue.
  const [reviewDecisions, setReviewDecisions] = useState(() => new Map());
  // Session id derived from the imported dataset signature.
  const sessionId = useMemo(() => deriveSessionId(rows), [rows]);
  // Toast for "Restored prior session" / "Cleared session".
  const [sessionToast, setSessionToast] = useState(/** @type {string|null} */ null);

  // Restore prior session state when sessionId becomes available.
  useEffect(() => {
    if (!sessionId) return;
    const loaded = loadSession(sessionId);
    if (!loaded) return;
    setAllEnrichedResults(loaded.allEnrichedResults || new Map());
    setEnrichedKeys(loaded.enrichedKeys || new Set());
    setExportedKeys(loaded.exportedKeys || new Set());
    setReviewDecisions(loaded.reviewDecisions || new Map());
    if ((loaded.allEnrichedResults?.size || 0) > 0) {
      setSessionToast(`Restored ${loaded.allEnrichedResults.size} prior result${loaded.allEnrichedResults.size !== 1 ? "s" : ""}`);
    }
  }, [sessionId]);

  // Throttled save: 500ms after the last state change, persist.
  useEffect(() => {
    if (!sessionId) return undefined;
    const handle = setTimeout(() => {
      saveSession(sessionId, {
        allEnrichedResults,
        enrichedKeys,
        exportedKeys,
        reviewDecisions,
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [sessionId, allEnrichedResults, enrichedKeys, exportedKeys, reviewDecisions]);

  // Auto-dismiss the session toast after 3s.
  useEffect(() => {
    if (!sessionToast) return undefined;
    const t = setTimeout(() => setSessionToast(null), 3000);
    return () => clearTimeout(t);
  }, [sessionToast]);

  // Auto-dismiss the dedup toast after 5s.
  useEffect(() => {
    if (!dedupToast) return undefined;
    const t = setTimeout(() => setDedupToast(null), 5000);
    return () => clearTimeout(t);
  }, [dedupToast]);

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

  // Per-package orchestrator runner (replaces runBatch when perPkgMode is ON)
  const runPerPkgMode = useCallback(async (pkgsToEnrich) => {
    if (!pkgsToEnrich?.length) return;
    if (orchAbortRef.current) orchAbortRef.current.abort();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    orchAbortRef.current = controller;

    // Group by owner+address — only representatives get enriched
    const pkgEntries = pkgsToEnrich.map((pkg) => ({
      packageKey: makePackageKey(pkg),
      package: pkg,
    }));
    const { groups, representatives } = groupPackagesByOwner(pkgEntries);

    const totalInput = pkgsToEnrich.length;
    const totalReps = representatives.length;
    setPkgTotal(totalReps);
    setPkgDone(0);

    if (totalInput !== totalReps) {
      setDedupToast(
        `Grouped ${totalInput} packages → ${totalReps} unique owner${totalReps !== 1 ? "s" : ""} (1 enrichment per owner, fanned out)`
      );
    }

    setEnrichState("loading");
    setEnrichError(null);
    setCurrentBatchResults(null);
    setEnrichStartedAt(Date.now());
    setEnrichElapsedMs(0);

    let completedCount = 0;

    const res = await runEnrichmentOrchestrator({
      packages: representatives,
      concurrency,
      callSingle: postEnrichmentSingle,
      signal: controller?.signal,
      onProgress: ({ packageKey, phase, result }) => {
        if (phase === "done" && result) {
          completedCount++;
          setPkgDone(completedCount);

          // Fan out to all grouped members
          const group = groups.get(packageKey) || [];
          const fanned = fanOutResult(result, group);

          setAllEnrichedResults((prev) => {
            const next = new Map(prev);
            for (const [key, r] of fanned) next.set(key, r);
            return next;
          });
          setEnrichedKeys((prev) => {
            const next = new Set(prev);
            for (const key of fanned.keys()) next.add(key);
            return next;
          });
        } else if (phase === "error") {
          setPkgDone((d) => d + 1);
        }
      },
    });

    if (controller && orchAbortRef.current !== controller) return;
    orchAbortRef.current = null;

    if (res.cancelled) {
      setEnrichState("idle");
    } else {
      // Collect batch results for the table from the final allEnrichedResults state
      setCurrentBatchResults([...res.results.values()]);
      setEnrichState("done");
    }
  }, [concurrency]);

  // Auto-advance: when a batch finishes successfully and auto-advance is
  // enabled and we're not paused, automatically queue the next batch.
  const handleEnrichNextRef = useRef(null);
  useEffect(() => {
    if (enrichState !== "done") return;
    if (!autoAdvance || paused) return;
    if (!nextBatchPkgs.length) return;
    const t = setTimeout(() => { handleEnrichNextRef.current?.(); }, 250);
    return () => clearTimeout(t);
  }, [enrichState, autoAdvance, paused, nextBatchPkgs.length]);

  // Cancel handler — aborts the in-flight fetch or orchestrator.
  const handleCancelEnrich = useCallback(() => {
    if (enrichAbortRef.current) {
      enrichAbortRef.current.abort();
      enrichAbortRef.current = null;
    }
    if (orchAbortRef.current) {
      orchAbortRef.current.abort();
      orchAbortRef.current = null;
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
    if (perPkgMode) {
      runPerPkgMode(nextBatchPkgs);
    } else {
      runBatch(nextBatchPkgs);
    }
  }, [nextBatchPkgs, allPkgs, enrichedKeys, runBatch, perPkgMode, runPerPkgMode]);

  // Keep ref in sync so auto-advance always invokes the latest closure.
  useEffect(() => { handleEnrichNextRef.current = handleEnrichNext; }, [handleEnrichNext]);

  // Review queue handlers.
  const handleReviewAccept = useCallback((packageKey, candidatePhone) => {
    setAllEnrichedResults((prev) => {
      const next = new Map(prev);
      const r = next.get(packageKey);
      if (r) next.set(packageKey, applyAcceptedDecision(r, candidatePhone));
      return next;
    });
    setReviewDecisions((prev) => {
      const next = new Map(prev);
      next.set(packageKey, { decision: "accepted", at: Date.now() });
      return next;
    });
  }, []);

  const handleReviewReject = useCallback((packageKey, candidatePhone) => {
    const r = allEnrichedResults.get(packageKey);
    markNeverCall({
      phone: candidatePhone?.raw || candidatePhone?.digits || r?.bestPhone || "",
      ownerName: r?.lead_owner_name || "",
      reason: "rejected_in_review",
    });
    setReviewDecisions((prev) => {
      const next = new Map(prev);
      next.set(packageKey, { decision: "rejected", at: Date.now() });
      return next;
    });
  }, [allEnrichedResults]);

  const handleReviewSkip = useCallback((packageKey) => {
    setReviewDecisions((prev) => {
      const next = new Map(prev);
      next.set(packageKey, { decision: "skipped", at: Date.now() });
      return next;
    });
  }, []);

  // Pause / Clear-session controls.
  const handlePauseToggle = useCallback(() => setPaused((p) => !p), []);
  const handleClearSession = useCallback(() => {
    if (!sessionId) return;
    if (typeof window !== "undefined" && !window.confirm(
      "Clear all enrichment results for this import? This cannot be undone."
    )) return;
    clearSession(sessionId);
    setAllEnrichedResults(new Map());
    setEnrichedKeys(new Set());
    setExportedKeys(new Set());
    setReviewDecisions(new Map());
    setCurrentBatchResults(null);
    setCurrentBatch(null);
    setCurrentBatchRange(null);
    setSessionToast("Session cleared");
  }, [sessionId]);

  // Live scorecard summary across the whole session.
  const sessionSummary = useMemo(
    () => summarizeSession(allEnrichedResults, reviewDecisions),
    [allEnrichedResults, reviewDecisions],
  );

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
                {/* Per-package mode toggle */}
                <label style={{ fontSize: 11, color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={perPkgMode}
                    onChange={(e) => setPerPkgMode(e.target.checked)}
                    disabled={enrichState === "loading"}
                  />
                  Per-package mode
                </label>
                {perPkgMode ? (
                  <label style={{ fontSize: 11, color: "var(--text3)" }}>
                    Concurrency:&nbsp;
                    <select
                      value={concurrency}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      disabled={enrichState === "loading"}
                      style={{ fontSize: 11, padding: "1px 4px" }}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ) : (
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
                )}
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

            {/* Live scorecard — running totals across the whole session. */}
            {hasAnyResults && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: "flex", flexWrap: "wrap", gap: 12,
                  fontSize: 11, marginBottom: 8,
                  padding: "6px 10px",
                  background: "var(--bg2, #fafafa)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                <span><strong>{enrichedKeys.size}</strong> / {allPkgs.length} processed</span>
                <span style={{ color: "#166534" }}><strong>{sessionSummary.ready}</strong> ready</span>
                <span style={{ color: "#854D0E" }}><strong>{sessionSummary.review}</strong> review</span>
                <span style={{ color: "#1E40AF" }}><strong>{sessionSummary.email}</strong> email</span>
                <span style={{ color: "var(--text3)" }}><strong>{sessionSummary.none}</strong> none</span>
                {sessionSummary.accepted > 0 && (
                  <span style={{ color: "#166534" }}>{sessionSummary.accepted} accepted</span>
                )}
                {sessionSummary.rejected > 0 && (
                  <span style={{ color: "#991B1B" }}>{sessionSummary.rejected} rejected</span>
                )}
              </div>
            )}

            {/* Session toast (refresh-restore / clear). */}
            {sessionToast && (
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                {sessionToast}
              </div>
            )}

            {/* Dedup toast — shown once when owner grouping kicks in. */}
            {dedupToast && (
              <div style={{
                fontSize: 11, color: "#1E40AF",
                background: "#DBEAFE", borderRadius: 6,
                padding: "4px 10px", marginBottom: 6,
              }}>
                {dedupToast}
              </div>
            )}

            {/* Action buttons */}
            {enrichState !== "loading" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="btn btn-sm"
                  onClick={handleEnrichNext}
                  disabled={!nextBatchPkgs.length || paused}
                >
                  {hasAnyResults
                    ? `Enrich next ${Math.min(nextBatchPkgs.length, batchSize)} target${Math.min(nextBatchPkgs.length, batchSize) !== 1 ? "s" : ""}`
                    : `Enrich first ${Math.min(nextBatchPkgs.length, batchSize)} target${Math.min(nextBatchPkgs.length, batchSize) !== 1 ? "s" : ""}`}
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
                <label style={{ fontSize: 11, color: "var(--text2)", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                  />
                  Auto-advance
                </label>
                {autoAdvance && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handlePauseToggle}
                    style={{ color: "var(--text3)" }}
                    title={paused ? "Resume auto-advance" : "Pause auto-advance"}
                  >
                    {paused ? "Resume" : "Pause"}
                  </button>
                )}
                {hasAnyResults && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handleClearSession}
                    style={{ color: "var(--text3)", marginLeft: "auto" }}
                    title="Clear all enrichment results for this import"
                  >
                    Clear session
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
                    {perPkgMode
                      ? `${pkgDone} / ${pkgTotal} packages enriched…`
                      : `Enriching ${currentBatch?.length || 0} package${(currentBatch?.length || 0) !== 1 ? "s" : ""}…`}
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

            {/* Tab switcher: current batch vs. session-wide review queue. */}
            {hasAnyResults && (
              <div style={{ display: "flex", gap: 0, marginTop: 6, marginBottom: 6, borderBottom: "1px solid var(--border)" }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setActiveTab("batch")}
                  style={{
                    background: "transparent",
                    borderBottom: activeTab === "batch" ? "2px solid var(--accent, #2563EB)" : "2px solid transparent",
                    borderRadius: 0,
                    fontWeight: activeTab === "batch" ? 600 : 400,
                  }}
                >
                  Current batch ({currentBatchResults?.length || 0})
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setActiveTab("review")}
                  style={{
                    background: "transparent",
                    borderBottom: activeTab === "review" ? "2px solid var(--accent, #2563EB)" : "2px solid transparent",
                    borderRadius: 0,
                    fontWeight: activeTab === "review" ? 600 : 400,
                  }}
                >
                  Review queue ({sessionSummary.review + sessionSummary.email})
                </button>
              </div>
            )}

            {/* Current batch results table */}
            {activeTab === "batch" && enrichState === "done" && currentBatchResults && (
              currentBatchResults.length === 0
                ? <div style={{ fontSize: 12, color: "var(--text3)" }}>(no results in batch)</div>
                : <EnrichResultsTable results={currentBatchResults} />
            )}

            {/* Session-wide review queue */}
            {activeTab === "review" && (
              <ReviewQueue
                allEnrichedResults={allEnrichedResults}
                reviewDecisions={reviewDecisions}
                onAccept={handleReviewAccept}
                onReject={handleReviewReject}
                onSkip={handleReviewSkip}
              />
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
