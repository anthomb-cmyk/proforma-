// Extracted from App.js as part of the page-level split.
// Self-contained: all helpers (parseCSV, parseSpreadsheet, batching, run
// persistence) are scoped to this component. Parent communication is
// limited to the two callback props below.
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  mergePhoneLists,
  normalizePhoneKey,
  extractPhonesFromRow,
} from "../lib/phoneUtils.js";
import { firstBusinessLookupName } from "../lib/businessName.js";
import useDebouncedValue from "../lib/useDebouncedValue.js";
import useToast from "../lib/useToast.js";
import useEscapeKey from "../lib/useEscapeKey.js";
import useFocusHotkey from "../lib/useFocusHotkey.js";
import { estimateLookupCost, formatCost } from "../lib/phoneLookupCost.js";
import { loadTodaySpend, recordBatch } from "../lib/dailySpendTracker.js";
import {
  parseCSV,
  parseSpreadsheet,
  isSpreadsheetFile,
  normalizeHeader as normalizeHeaderKey,
} from "../lib/tableImport.js";
import PhoneResultRow from "../components/PhoneResultRow.jsx";
import {
  loadRunsFromStorage,
  persistRunsDiff,
  clearRunsFromStorage,
} from "../lib/pfRunsStorage.js";

// Rows per API call — keeps POST /api/phone-lookup under the proxy timeout.
const BATCH_SIZE = 10;
// LocalStorage key for the id of the currently open run.
const PF_ACTIVE_RUN_KEY = "pf_active_run";
// Cap on the number of runs we keep in memory (oldest evicted).
const MAX_PHONE_RUNS = 40;

function PhoneFinder({ onExportFoundToLeads, onOpenLeads, t: tProp, lang: langProp }) {
  // Fallbacks keep the component standalone-renderable (e.g. storybook/tests)
  // when hosted outside the main App shell that normally provides the i18n
  // plumbing. `t` passes through the raw key, `lang` stays FR by default.
  const t = tProp || ((k) => k);
  const lang = langProp || "fr";
  const localeTag = lang === "en" ? "en-CA" : "fr-CA";
  function normalizeResultRowPhones(row = {}) {
    const validPhones = mergePhoneLists(row?.phone, row?.inputPhones);
    const status = validPhones.length > 0
      ? "found"
      : (row?.status === "found" ? "not_found" : (row?.status || "not_found"));
    return {
      ...row,
      phone: validPhones[0] || "",
      inputPhones: validPhones,
      status,
    };
  }

  function rowHasAnyPhone(row) {
    return mergePhoneLists(row?.phone, row?.inputPhones).length > 0;
  }

  const [pfPage, setPfPage] = useState("search");
  const [pfTab, setPfTab] = useState("manual");
  const [form, setForm] = useState({ name:"", address:"", city:"", province:"Québec", postalCode:"", country:"Canada" });
  const [resultRuns, setResultRuns] = useState(() => {
    // Sharded storage (pf_runs_index + pf_run:<id>) auto-migrates the
    // legacy single-blob `pf_runs` key on first read. Normalize rows here
    // because the storage layer is agnostic to our phone-row shape.
    const loaded = loadRunsFromStorage();
    if (loaded.length) {
      return loaded
        .map((run, idx) => {
          const rows = Array.isArray(run.rows) ? run.rows.map(normalizeResultRowPhones) : [];
          const createdAt = run.createdAt || new Date().toISOString();
          const fallbackTitle = t("pf_run_import_of", new Date(createdAt).toLocaleString(localeTag, { dateStyle:"medium", timeStyle:"short" }));
          return {
            id: run.id || `pf_run_${Date.now()}_${idx}`,
            title: run.title || fallbackTitle,
            source: run.source || "csv",
            createdAt,
            updatedAt: run.updatedAt || createdAt,
            totalRows: Number.isFinite(run.totalRows) ? run.totalRows : rows.length,
            foundCount: Number.isFinite(run.foundCount) ? run.foundCount : rows.filter(rowHasAnyPhone).length,
            rows,
          };
        })
        .slice(0, MAX_PHONE_RUNS);
    }
    // Secondary legacy path: an even older build persisted a flat rows
    // array under `pf_results` (no wrapping run record). Promote it into
    // a single synthetic run so users don't lose historical enrichments.
    // Clean up the key afterwards — we no longer write to it, so leaving
    // it around would trip this branch again on the next load.
    try {
      const legacy = JSON.parse(localStorage.getItem("pf_results") || "[]");
      if (Array.isArray(legacy) && legacy.length) {
        const rows = legacy.map(normalizeResultRowPhones);
        const createdAt = new Date().toISOString();
        localStorage.removeItem("pf_results");
        return [{
          id: `pf_run_legacy_${Date.now()}`,
          title: t("pf_run_legacy", new Date(createdAt).toLocaleString(localeTag, { dateStyle:"medium", timeStyle:"short" })),
          source: "legacy",
          createdAt,
          updatedAt: createdAt,
          totalRows: rows.length,
          foundCount: rows.filter(rowHasAnyPhone).length,
          rows,
        }];
      }
    } catch {}
    return [];
  });
  const [activeRunId, setActiveRunId] = useState(() => {
    try { return localStorage.getItem(PF_ACTIVE_RUN_KEY) || null; } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [progress, setProgress] = useState(null); // { done, total }
  const [csvFile, setCsvFile] = useState(null);
  const [colMap, setColMap] = useState({});
  const [showColMap, setShowColMap] = useState(false);
  // filter.search is no longer used — we read the debounced searchInput
  // directly into filteredResults. Kept in state for status etc.
  const [filter, setFilter] = useState({ status:"all" });
  // searchInput mirrors the <input> so typing stays snappy; debouncedSearch
  // is the value the filter reads — coalesces keystroke bursts into one
  // filter pass + 100-row <PhoneResultRow> repaint.
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 180);
  // Cmd/Ctrl+K focuses the results filter — matches the same shortcut on
  // LeadsManager so both pages feel consistent.
  const searchRef = useRef(null);
  useFocusHotkey(searchRef);
  const [reviewRow, setReviewRow] = useState(null);
  const [page, setPage] = useState(1);
  // useToast cancels pending hide-timers on unmount so we never
  // setState on a dead component, and coalesces rapid showToast calls
  // so earlier toasts don't blank out later ones mid-display.
  const { toast, showToast } = useToast();
  const [exportBusy, setExportBusy] = useState(false);
  const stopRef = useRef(false);
  // AbortController for the current phone-lookup batch fetch so the Stop
  // button cancels the in-flight network request instead of only stopping
  // the next batch iteration.
  const lookupAbortRef = useRef(null);
  const PAGE_SIZE = 100;

  // When the debounced search changes, jump back to page 1 so freshly
  // filtered matches are visible from the top.
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  // Pre-flight confirmation before a CSV batch runs. `pendingLookup`
  // holds { rows, source } while the cost estimate modal is open.
  // Users can cancel and avoid the $ spend, or confirm to kick off
  // the batch. Single-row manual searches (too cheap to be worth
  // confirming) bypass this and call doLookupBatched directly.
  const [pendingLookup, setPendingLookup] = useState(null);
  // GPT planner toggle (stored locally so the preference sticks across
  // sessions — most users will land on one mode and never switch). When
  // enabled, confirmPendingLookup first POSTs to /api/phone-lookup/plan
  // to get deterministic + GPT-optimized strategies per row, then passes
  // those plans through to /api/phone-lookup.
  const [useGptPlanner, setUseGptPlanner] = useState(() => {
    try { return localStorage.getItem("pf_use_gpt_planner") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("pf_use_gpt_planner", useGptPlanner ? "1" : "0"); } catch {}
  }, [useGptPlanner]);
  // Planner state. `planningBusy` is true while /plan is in flight;
  // `planResult` holds { plans, stats } after the call succeeds. The
  // cost modal flips from "configure" mode to "preview" mode once
  // planResult is populated so the user sees the 3-bucket breakdown
  // before authorising the Places spend.
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planResult, setPlanResult] = useState(null);
  // Running tally of today's phone-lookup spend, persisted in
  // localStorage and shown in the page header. Resets at midnight
  // local time (see dailySpendTracker). Updated after each batch
  // finishes so the user sees their spend climb in near-real-time.
  const [dailySpend, setDailySpend] = useState(() => loadTodaySpend());

  // Esc dismisses whichever modal is open. The hook only attaches its
  // keydown listener while `active` is truthy, so we never intercept
  // Escape when nothing's on screen.
  useEscapeKey(() => setReviewRow(null), Boolean(reviewRow));
  useEscapeKey(() => setShowColMap(false), showColMap);
  useEscapeKey(() => { setPendingLookup(null); setPlanResult(null); }, Boolean(pendingLookup));

  const activeRun = useMemo(() => resultRuns.find(run => run.id === activeRunId) || null, [resultRuns, activeRunId]);
  const results = activeRun?.rows || [];

  // Tracks the last resultRuns we handed to persistRunsDiff so we can
  // diff identity-stably across renders. Seeded with the initial loaded
  // value so the first mount does NOT rewrite every shard just because
  // useEffect fires on mount — storage is already in sync at that point
  // (loadRunsFromStorage's migration path writes everything it needs).
  const lastPersistedRef = useRef(resultRuns);

  useEffect(() => {
    // persistRunsDiff compares prev vs. next run objects by identity on
    // .rows — renaming a run (spread keeps rows stable) writes only the
    // small index blob; editing rows of one run writes only that shard
    // instead of re-serializing all 40 runs. Removes shards whose runs
    // disappeared. _src stripping happens inside persistRunsDiff.
    const prev = lastPersistedRef.current;
    if (prev === resultRuns) return; // identity unchanged, nothing to do
    persistRunsDiff(prev, resultRuns);
    lastPersistedRef.current = resultRuns;
  }, [resultRuns]);

  useEffect(() => {
    try {
      if (activeRunId) localStorage.setItem(PF_ACTIVE_RUN_KEY, activeRunId);
      else localStorage.removeItem(PF_ACTIVE_RUN_KEY);
    } catch {}
  }, [activeRunId]);

  useEffect(() => {
    if (!resultRuns.length) {
      if (activeRunId) setActiveRunId(null);
      return;
    }
    if (!activeRunId || !resultRuns.some(run => run.id === activeRunId)) {
      setActiveRunId(resultRuns[0].id);
    }
  }, [resultRuns, activeRunId]);

  useEffect(() => {
    setPage(1);
    setFilter({ status:"all" });
    setSearchInput("");
    setReviewRow(null);
  }, [activeRunId]);

  function formatRunDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(localeTag, { dateStyle:"medium", timeStyle:"short" });
  }

  function makeRunTitle(source, createdAt = new Date().toISOString()) {
    const stamp = formatRunDate(createdAt);
    if (source === "manual") return t("pf_run_default_manual", stamp);
    return t("pf_run_default_csv", stamp);
  }

  function buildRunPatch(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    return {
      rows: safeRows,
      totalRows: safeRows.length,
      foundCount: safeRows.filter(rowHasAnyPhone).length,
      updatedAt: new Date().toISOString(),
    };
  }

  function updateActiveRunRows(updater) {
    if (!activeRunId) return;
    setResultRuns(prev => prev.map(run => {
      if (run.id !== activeRunId) return run;
      const currentRows = Array.isArray(run.rows) ? run.rows : [];
      const nextRows = typeof updater === "function" ? updater(currentRows) : updater;
      return { ...run, ...buildRunPatch(nextRows) };
    }));
  }

  function removeRun(runId) {
    setResultRuns(prev => prev.filter(run => run.id !== runId));
    setActiveRunId(prev => (prev === runId ? null : prev));
    setReviewRow(null);
  }

  function renameRun(runId, nextTitle) {
    const cleaned = String(nextTitle || "").trim();
    if (!cleaned) return false;
    setResultRuns(prev => prev.map(run => run.id === runId ? { ...run, title: cleaned.slice(0, 120) } : run));
    return true;
  }

  function askRenameRun(run) {
    if (!run) return;
    const next = window.prompt(t("pf_rename_prompt"), run.title || "");
    if (next === null) return;
    const ok = renameRun(run.id, next);
    if (!ok) {
      showToast(t("pf_rename_err_empty"), 3500);
    }
  }

  function clearAllRuns() {
    if (!window.confirm(t("pf_delete_all_confirm"))) return;
    setResultRuns([]);
    setActiveRunId(null);
    setReviewRow(null);
    setFilter({ status:"all" });
    setSearchInput("");
    setPage(1);
    setPfPage("search");
    // Defense-in-depth: persistRunsDiff([], []) will also delete the
    // shards, but an explicit sweep catches any orphans left by a prior
    // crash mid-write or a stale legacy key. No-op if storage is empty.
    clearRunsFromStorage();
  }

  async function exportRunToLeads(run = activeRun) {
    if (!run) return;
    const rowsToExport = (run.rows || []).filter(rowHasAnyPhone);
    if (!rowsToExport.length) {
      showToast(t("pf_export_no_phones"), 3500);
      return;
    }
    if (typeof onExportFoundToLeads !== "function") {
      showToast(t("pf_export_unavailable"), 3500);
      return;
    }

    setExportBusy(true);
    // The finally clause clears the busy flag + auto-hides the toast.
    // We show the success/error toast eagerly so the display isn't
    // racy with setExportBusy; showToast cancels any prior timer so
    // whichever message lands last survives its full 5-second window.
    try {
      const result = await Promise.resolve(onExportFoundToLeads(rowsToExport, {
        id: run.id,
        title: run.title,
        createdAt: run.createdAt,
      }));
      const added = Number(result?.added || 0);
      const updated = Number(result?.updated || 0);
      const skipped = Number(result?.skipped || 0);
      if (added > 0 || updated > 0) {
        const parts = [];
        if (added > 0) parts.push(t("pf_export_part_new", added));
        if (updated > 0) parts.push(t("pf_export_part_updated", updated));
        if (skipped > 0) parts.push(t("pf_export_part_skipped", skipped));
        showToast(t("pf_export_leads_updated", parts.join(" · ")), 5000);
        if (typeof onOpenLeads === "function") {
          setTimeout(() => onOpenLeads(), 250);
        }
      } else {
        showToast(t("pf_export_nothing_new"), 5000);
      }
    } catch (err) {
      showToast(t("pf_export_impossible", String(err?.message || err)), 5000);
    } finally {
      setExportBusy(false);
    }
  }

  // parseCSV / parseSpreadsheet / isSpreadsheetFile / normalizeHeader now
  // live in lib/tableImport.js — imported above (aliased to
  // normalizeHeaderKey for readability since this file has a file-local
  // normalizeTextKey that does something slightly different).

  function pickMappedValue(row, columnName) {
    if (!columnName) return "";
    return String(row?.[columnName] || "").trim();
  }

  function autoDetectCols(headers) {
    const map = {};
    const normalized = headers.map(h => ({ raw: h, norm: normalizeHeaderKey(h) }));
    const used = new Set();
    const findHeader = (patterns) => {
      const match = normalized.find(({ raw, norm }) => !used.has(raw) && patterns.some(rx => rx.test(norm)));
      if (!match) return "";
      used.add(match.raw);
      return match.raw;
    };
    const patterns = {
      address: [
        /\badresses? immeubles? clean\b/,  // prefer clean column (e.g. "adresses immeubles clean")
        /\badresses? immeubles?\b/,         // fallback: plural or singular without suffix
        /\badresse immeuble\b/,
        /\badresse\b(?!.*postale)/,         // avoid postal address columns
        /\baddress\b(?!.*postal)/,
        /\brue\b/,
        /\bstreet\b/,
      ],
      city: [
        /\bville immeuble\b/,
        /\bville\b/,
        /\bcity\b/,
      ],
      province: [
        /\bprovince\b/,
        /\betat\b/,
        /\bstate\b/,
      ],
      postalCode: [
        /\bcode postal immeuble\b/,
        /\bcode postal\b/,
        /\bpostal\b/,
        /\bzip\b/,
      ],
      country: [
        /\bpays\b/,
        /\bcountry\b/,
      ],
      company: [
        /\bcompany\b/,
        /\bcompagnie\b/,
        /\bentreprise\b/,
        /\braison sociale\b/,
        /\borganisation\b/,
      ],
      leadContact: [
        /\bnom complet\b/,
        /\bproprietaire\b/,
        /\bcontact\b/,
        /\bprenom\b/,
        /\bnom\b/,
        /\bowner\b/,
      ],
      phone: [
        /\btelephone\b/,
        /\bphone\b/,
        /\bcell\b/,
        /\bmobile\b/,
        /\btel\b/,
      ],
      name: [
        /\bnom entreprise\b/,
        /\bbusiness name\b/,
        /\bname\b/,
        /\bnom\b/,
        /\bcompany\b/,
        /\bentreprise\b/,
      ],
    };

    for (const key of ["address", "city", "province", "postalCode", "country", "company", "leadContact", "phone", "name"]) {
      const found = findHeader(patterns[key]);
      if (found) map[key] = found;
    }
    return map;
  }

  // Mirror the server-side applyGlobalPhoneCap but run client-side across ALL
  // batches once the full run is collected, closing the 10-row-window gap.
  // (The server cap only fires within each 10-row request; a shared public number
  // that appears on rows spread across multiple batches would otherwise survive.)
  function clientApplyPhoneCap(rows, cap) {
    if (!cap || cap <= 0) return rows;
    const addressesByPhone = new Map();
    for (const r of rows) {
      const onlinePhones = mergePhoneLists(r.onlinePhones);
      const addrKey = normalizeHeaderKey(r.buildingAddress || r.inputAddress || "");
      for (const p of onlinePhones) {
        const k = normalizePhoneKey(p);
        if (!k) continue;
        if (!addressesByPhone.has(k)) addressesByPhone.set(k, new Set());
        addressesByPhone.get(k).add(addrKey);
      }
    }
    const blacklisted = new Set();
    for (const [k, addrs] of addressesByPhone) {
      if (addrs.size > cap) blacklisted.add(k);
    }
    if (!blacklisted.size) return rows;
    return rows.map(r => {
      const survivingOnline = mergePhoneLists(r.onlinePhones).filter(p => {
        const k = normalizePhoneKey(p);
        return !k || !blacklisted.has(k);
      });
      const filePhones = mergePhoneLists(r.fileInputPhones);
      const allPhones = mergePhoneLists(filePhones, survivingOnline);
      if (allPhones.length === mergePhoneLists(r.inputPhones).length) return r; // unchanged
      const status = allPhones.length ? "found" : "not_found";
      return {
        ...r,
        onlinePhones: survivingOnline,
        phone: allPhones[0] || "",
        inputPhones: allPhones,
        status,
        statusLabel: status === "found" ? t("pf_status_found") : t("pf_status_not_found"),
        matchedName: survivingOnline.length ? r.matchedName : "",
        matchedAddress: survivingOnline.length ? r.matchedAddress : "",
        website: survivingOnline.length ? r.website : "",
        confidence: survivingOnline.length ? r.confidence : 0,
      };
    });
  }

  // Re-run the lookup for a single result row using its stored _src.
  async function rerunSingleRow(resultRow) {
    if (!resultRow?._src) return;
    setLoading(true);
    setApiError("");
    try {
      const resp = await fetch("/api/phone-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [resultRow._src] }),
      });
      const data = await resp.json();
      if (!data.ok) {
        if (resp.status === 402) {
          setApiError(data.error || t("pf_err_budget"));
          return;
        }
        setApiError(data.error || t("pf_err_server"));
        return;
      }
      if (data.budget && typeof data.budget.spentUsd === "number") {
        setDailySpend(prev => ({ ...prev, estCost: data.budget.spentUsd, date: data.budget.date || prev.date }));
      }
      const rawResult = data.results?.[0];
      if (!rawResult) return;
      const src = resultRow._src;
      const buildingAddress = src.buildingAddress || [src.address, src.city, src.province, src.postalCode].filter(Boolean).join(", ");
      const companyName = src.company || "";
      const leadContact = src.leadContact || "";
      const fallbackName = src.rawName || src.name || "";
      const inputPhones = mergePhoneLists(src.inputPhones, rawResult.inputPhones);
      const updated = normalizeResultRowPhones({
        ...rawResult,
        inputName: companyName || rawResult.inputName || fallbackName,
        inputAddress: buildingAddress || rawResult.inputAddress || "",
        buildingAddress: buildingAddress || "",
        companyName,
        leadContact,
        inputPhones,
        id: resultRow.id,
        _src: src,
      });
      updateActiveRunRows(prev => prev.map(r => r.id === resultRow.id ? updated : r));
      showToast(
        updated.status === "found" ? t("pf_rerun_toast_found") : t("pf_rerun_toast_not_found"),
        4000,
      );
    } catch (err) {
      setApiError(t("pf_err_generic", err.message));
    } finally {
      setLoading(false);
    }
  }

  // Re-run the lookup for ALL not_found rows in the active run.
  async function rerunNotFound() {
    const notFoundRows = results.filter(r => r.status === "not_found" && r._src);
    if (!notFoundRows.length) {
      showToast(t("pf_rerun_none"), 5000);
      return;
    }
    stopRef.current = false;
    setLoading(true);
    setApiError("");
    setProgress({ done: 0, total: notFoundRows.length });
    let done = 0;
    const updatedById = new Map();
    for (let i = 0; i < notFoundRows.length; i += BATCH_SIZE) {
      if (stopRef.current) break;
      const sliceRows = notFoundRows.slice(i, i + BATCH_SIZE);
      const sliceSrc = sliceRows.map(r => r._src);
      try {
        const resp = await fetch("/api/phone-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: sliceSrc }),
        });
        const data = await resp.json();
        if (!data.ok) {
          if (resp.status === 402) {
            setApiError(data.error || t("pf_err_budget"));
            break;
          }
          setApiError(data.error || t("pf_err_server"));
          break;
        }
        if (data.budget && typeof data.budget.spentUsd === "number") {
          setDailySpend(prev => ({ ...prev, estCost: data.budget.spentUsd, date: data.budget.date || prev.date }));
        }
        const rawChunk = Array.isArray(data.results) ? data.results : [];
        rawChunk.forEach((rawResult, idx) => {
          const origRow = sliceRows[idx];
          const src = sliceSrc[idx] || {};
          if (!origRow) return;
          const buildingAddress = src.buildingAddress || [src.address, src.city, src.province, src.postalCode].filter(Boolean).join(", ");
          const companyName = src.company || "";
          const leadContact = src.leadContact || "";
          const fallbackName = src.rawName || src.name || "";
          const inputPhones = mergePhoneLists(src.inputPhones, rawResult.inputPhones);
          const updated = normalizeResultRowPhones({
            ...rawResult,
            inputName: companyName || rawResult.inputName || fallbackName,
            inputAddress: buildingAddress || rawResult.inputAddress || "",
            buildingAddress: buildingAddress || "",
            companyName,
            leadContact,
            inputPhones,
            id: origRow.id,
            _src: src,
          });
          updatedById.set(origRow.id, updated);
        });
        done += sliceRows.length;
        setProgress({ done, total: notFoundRows.length });
      } catch (err) {
        setApiError(t("pf_err_network_batch", Math.floor(i / BATCH_SIZE) + 1, err.message));
        break;
      }
    }
    updateActiveRunRows(prev => prev.map(r => updatedById.has(r.id) ? updatedById.get(r.id) : r));
    const newlyFound = [...updatedById.values()].filter(r => r.status === "found").length;
    showToast(
      t("pf_rerun_summary", done, newlyFound),
      6000,
    );
    setLoading(false);
    setProgress(null);
  }

  // Send rows in small batches so each request completes in < 5s (no proxy timeout)
  async function doLookupBatched(allRows, source = "csv", opts = {}) {
    const skippedWithPhone = Array.isArray(opts.skippedWithPhone) ? opts.skippedWithPhone : [];
    // GPT-planner extensions (optional). `plans[i]` matches allRows[i] 1:1
    // when present — absent entries just fall through to the server's
    // deterministic path. `manualReviewRows` are plan.strategy === "skip_no_lead"
    // rows that never hit Places; we materialise them as needs_manual_review
    // result rows so they still appear in the run.
    const planArray = Array.isArray(opts.plans) ? opts.plans : null;
    const manualReviewRows = Array.isArray(opts.manualReviewRows) ? opts.manualReviewRows : [];
    const manualReviewPlans = Array.isArray(opts.manualReviewPlans) ? opts.manualReviewPlans : [];
    stopRef.current = false;
    setLoading(true);
    setApiError("");
    setProgress({ done: 0, total: allRows.length });
    setPage(1);

    const runId = `plrun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();
    const run = {
      id: runId,
      title: makeRunTitle(source, createdAt),
      source,
      createdAt,
      totalRows: 0,
      foundCount: 0,
      rows: [],
    };

    setResultRuns(prev => [run, ...prev].slice(0, MAX_PHONE_RUNS));
    setActiveRunId(runId);
    setPfPage("results");

    // Synthesize "found" rows for entries that already had a phone in the
    // file. These never hit Google Places so they cost nothing, but they
    // still belong in the run so the user sees a complete dataset and can
    // export every lead in one click. Status is "found" with source "file"
    // so the UI can visually distinguish them from Places hits.
    const fileOnlyRows = skippedWithPhone.map((src) => {
      const buildingAddress = src.buildingAddress || [src.address, src.city, src.province, src.postalCode].filter(Boolean).join(", ");
      const companyName = src.company || "";
      const fallbackName = src.rawName || src.name || "";
      const inputPhones = src.inputPhones || [];
      return normalizeResultRowPhones({
        inputName: companyName || fallbackName,
        inputAddress: buildingAddress,
        buildingAddress,
        companyName,
        leadContact: src.leadContact || "",
        matchedName: "",
        matchedAddress: "",
        phone: inputPhones[0] || "",
        inputPhones,
        fileInputPhones: inputPhones,
        onlinePhones: [],
        directoryPhones: [],
        source: "file",
        status: "found",
        statusLabel: lang === "en" ? "On file" : "Au fichier",
        confidence: 100,
        website: "",
        candidates: [],
        searchedAt: createdAt,
        trace: ["skip:file_phone"],
        _src: src,
      });
    });

    // Materialise manual-review rows (plan.strategy === "skip_no_lead").
    // These stay in the run so the user can inspect / export them, but
    // they never hit the Places API.
    const manualOnlyRows = manualReviewRows.length
      ? buildManualReviewRows(manualReviewRows, manualReviewPlans, createdAt)
      : [];

    let done = 0;
    let added = fileOnlyRows.length;
    let runRows = [...fileOnlyRows, ...manualOnlyRows];

    // Commit the file-only + manual-review rows to the run immediately so
    // the results table populates before the API batch even starts.
    if (runRows.length) {
      setResultRuns(prev => prev.map(r => r.id === runId ? { ...r, ...buildRunPatch(runRows) } : r));
    }

    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      if (stopRef.current) break;
      const batch = allRows.slice(i, i + BATCH_SIZE);
      // Slice the matching plans for this batch. If no plans were provided
      // (non-GPT mode), pass undefined so server falls back to its
      // deterministic regex-based query builder.
      const batchPlans = planArray ? planArray.slice(i, i + BATCH_SIZE) : undefined;
      const controller = new AbortController();
      lookupAbortRef.current = controller;
      try {
        const resp = await fetch("/api/phone-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch, ...(batchPlans ? { plans: batchPlans } : {}) }),
          signal: controller.signal,
        });
        const data = await resp.json();
        if (!data.ok) {
          if (resp.status === 402) {
            setApiError(data.error || t("pf_err_budget"));
            break;
          }
          setApiError(data.error || t("pf_err_server"));
          break;
        }
        if (data.budget && typeof data.budget.spentUsd === "number") {
          setDailySpend(prev => ({ ...prev, estCost: data.budget.spentUsd, date: data.budget.date || prev.date }));
        }
        const rawChunk = Array.isArray(data.results) ? data.results : [];
        const chunk = rawChunk.map((rowResult, idx) => {
          const src = batch[idx] || {};
          const buildingAddress = src.buildingAddress || [src.address, src.city, src.province, src.postalCode].filter(Boolean).join(", ");
          const companyName = src.company || "";
          const leadContact = src.leadContact || "";
          const fallbackName = src.rawName || src.name || "";
          const inputPhones = mergePhoneLists(src.inputPhones, rowResult.inputPhones);
          return {
            ...rowResult,
            inputName: companyName || rowResult.inputName || fallbackName,
            inputAddress: buildingAddress || rowResult.inputAddress || "",
            buildingAddress: buildingAddress || "",
            companyName,
            leadContact,
            inputPhones,
            _src: src,  // kept in memory only; stripped before localStorage save
          };
        });
        const normalizedChunk = chunk.map(normalizeResultRowPhones);
        const found = normalizedChunk.filter(rowHasAnyPhone);
        runRows = [...runRows, ...normalizedChunk];
        setResultRuns(prev => prev.map(r => r.id === runId ? { ...r, ...buildRunPatch(runRows) } : r));
        done += batch.length;
        added += found.length;
        setProgress({ done, total: allRows.length });
      } catch (err) {
        // AbortError fires when the user clicks Stop — exit the loop silently.
        if (err?.name === "AbortError") break;
        setApiError(t("pf_err_network_batch", Math.floor(i / BATCH_SIZE) + 1, err.message));
        break;
      } finally {
        if (lookupAbortRef.current === controller) lookupAbortRef.current = null;
      }
    }

    // Apply a client-side frequency cap across ALL batches to catch shared public
    // numbers that slipped through because they were split across batch windows.
    const cappedRows = clientApplyPhoneCap(runRows, 3);
    if (cappedRows !== runRows) {
      setResultRuns(prev => prev.map(r => r.id === runId ? { ...r, ...buildRunPatch(cappedRows) } : r));
    }

    setLoading(false);
    setProgress(null);

    // Add what we actually ran to today's spend tally so the header
    // counter reflects the real row count (not the pre-flight estimate
    // which is based on total rows — if the user hit Stop midway, we
    // only charge for `done` rows). estimateLookupCost's midpoint is
    // a reasonable proxy since we don't see the per-batch call count
    // from the backend in the response payload today.
    if (done > 0) {
      const est = estimateLookupCost(done);
      setDailySpend(recordBatch(done, est.mid));
    }

    // The run survives if either:
    //  - The API batch produced at least one result (done > 0), OR
    //  - There were file-only rows skipped from the batch (cost-free hits)
    // Otherwise (nothing was scanned and nothing was pre-filled), drop
    // the empty run and go back to search.
    if (done > 0 || fileOnlyRows.length > 0 || manualOnlyRows.length > 0) {
      const finalFound = cappedRows.filter(rowHasAnyPhone).length;
      showToast(t("pf_batch_ok", done + fileOnlyRows.length, finalFound), 6000);
      setPfPage("results");

      // Auto-export to Leads when we ran in GPT-planner mode. The planner
      // carries ownerKey on every result so we can group by owner. Non-GPT
      // mode keeps the existing manual "Export" button workflow — auto-
      // export only triggers when the user opted into the planner.
      if (planArray && typeof onExportFoundToLeads === "function") {
        try {
          // Export every row from the run (including file-only + manual-
          // review), not just the phone-bearing ones — the owner-grouped
          // target lead should list ALL buildings the owner appeared on
          // even if a subset had no matched phone.
          const result = await Promise.resolve(onExportFoundToLeads(cappedRows, {
            id: runId,
            title: makeRunTitle(source, createdAt),
            createdAt,
            ownerGrouped: true,
            auto: true,
          }));
          const added = Number(result?.added || 0);
          const updated = Number(result?.updated || 0);
          if (added > 0 || updated > 0) {
            showToast(
              lang === "en"
                ? `Auto-exported to Leads: ${added} new · ${updated} updated`
                : `Exporté automatiquement vers Leads : ${added} nouveau(x) · ${updated} mis à jour`,
              5000,
            );
          }
        } catch (err) {
          console.error("[PhoneFinder] auto-export failed:", err);
        }
      }
    } else {
      setResultRuns(prev => prev.filter(r => r.id !== runId));
      setPfPage("search");
    }
  }

  async function searchManual() {
    const lookupName = firstBusinessLookupName(form.name);
    if (!lookupName && !form.address) { setApiError(t("pf_err_need_name_or_addr")); return; }
    setApiError("");
    await doLookupBatched([{ ...form, name: lookupName }], "manual");
  }

  async function searchCSV() {
    if (!csvFile?.rows?.length) return;
    const rows = csvFile.rows.map(r => {
      const rawName = pickMappedValue(r, colMap.name);
      const company = pickMappedValue(r, colMap.company);
      const leadContact = pickMappedValue(r, colMap.leadContact);
      const mappedPhone = pickMappedValue(r, colMap.phone);
      const address = pickMappedValue(r, colMap.address);
      const city = pickMappedValue(r, colMap.city);
      const province = pickMappedValue(r, colMap.province);
      const postalCode = pickMappedValue(r, colMap.postalCode);
      const country = pickMappedValue(r, colMap.country) || "Canada";

      // Restrict lookup terms to business names only. Personal names stay as context
      // but are not sent as Places query terms.
      const lookupName = firstBusinessLookupName(company, rawName);
      const buildingAddress = [address, city, province, postalCode].filter(Boolean).join(", ");

      return {
        name: lookupName,
        rawName,
        company,
        leadContact,
        address,
        city,
        province,
        postalCode,
        country,
        buildingAddress,
        inputPhones: mergePhoneLists(mappedPhone, extractPhonesFromRow(r)),
        rawRow: r,
      };
    }).filter(item => Object.values(item.rawRow || {}).some(v => String(v ?? "").trim()));
    if (!rows.length) { setApiError(t("pf_err_no_rows")); return; }

    // Split rows by whether they already hold a NANP-valid phone anywhere
    // in the file (explicit phone column OR any freeform cell). mergePhoneLists
    // only returns entries that pass isValidNanpPhone, so formatting noise like
    // "555-0100 ext 3" or "(555)" doesn't falsely mark a row as "has phone".
    // Rows that already have a phone skip the Google Places batch entirely —
    // no API cost — and are injected as file-only "found" results instead.
    const rowsWithPhone = rows.filter(r => (r.inputPhones || []).length > 0);
    const rowsToEnrich = rows.filter(r => (r.inputPhones || []).length === 0);

    // Edge case: every single row already has a phone. Nothing to enrich —
    // just stage the file-only rows as a run without showing the cost modal.
    if (!rowsToEnrich.length) {
      await doLookupBatched([], "csv", { skippedWithPhone: rowsWithPhone });
      return;
    }

    // Rather than firing the batch immediately, stage it behind the
    // cost-confirmation modal so the user gets an explicit "about to
    // spend ~$X" moment. Cheap to cancel, expensive to un-spend.
    setPendingLookup({
      rows: rowsToEnrich,
      skippedWithPhone: rowsWithPhone,
      source: "csv",
    });
  }

  // Run the GPT planner over the pending rows. Called when the user has
  // ticked "GPT-optimized lookup" in the confirm modal and clicks the
  // primary button for the first time. Sends ALL rows (enrich + file-phone)
  // to /plan so the planner's pre-filter is the single source of truth for
  // bucket classification. On success, stores { plans, stats } in
  // planResult — the modal re-renders into preview mode and the primary
  // button changes to "Launch". On failure, shows an inline error but
  // leaves the modal open so the user can uncheck GPT and try again.
  async function runPlannerForPending() {
    const pending = pendingLookup;
    if (!pending) return;
    setPlanningBusy(true);
    setApiError("");
    try {
      // Planner receives the raw source row (including file-phone rows)
      // because its pre-filter re-evaluates the phone-present test itself.
      const allRows = [
        ...(pending.rows || []),
        ...(pending.skippedWithPhone || []),
      ];
      const resp = await fetch("/api/phone-lookup/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: allRows.map((r) => r.rawRow || r) }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setApiError(data.error || t("pf_err_server"));
        return;
      }
      setPlanResult({
        plans: Array.isArray(data.plans) ? data.plans : [],
        stats: data.stats || {},
        allRows,
        gptAvailable: Boolean(data.gptAvailable),
      });
    } catch (err) {
      setApiError(String(err?.message || err));
    } finally {
      setPlanningBusy(false);
    }
  }

  // Build "needs_manual_review" result rows for plan.strategy === "skip_no_lead".
  // These never hit Places but still belong in the run so the user can see
  // them and decide manually.
  function buildManualReviewRows(rows, plans, createdAt) {
    return rows.map((src, idx) => {
      const plan = plans[idx] || null;
      const buildingAddress = src.buildingAddress || [src.address, src.city, src.province, src.postalCode].filter(Boolean).join(", ");
      const companyName = src.company || "";
      const fallbackName = src.rawName || src.name || "";
      return normalizeResultRowPhones({
        inputName: companyName || fallbackName,
        inputAddress: buildingAddress,
        buildingAddress,
        companyName,
        leadContact: src.leadContact || "",
        matchedName: "",
        matchedAddress: "",
        phone: "",
        inputPhones: [],
        onlinePhones: [],
        directoryPhones: [],
        source: "skipped",
        status: "needs_manual_review",
        statusLabel: lang === "en" ? "Needs review" : "À revoir",
        confidence: 0,
        website: "",
        candidates: [],
        searchedAt: createdAt,
        planStrategy: plan?.strategy || "skip_no_lead",
        planReason: plan?.reason || "",
        ownerKey: plan?.owner?.ownerKey || "",
        trace: [`plan:${plan?.strategy || "skip_no_lead"}:${plan?.reason || ""}`],
        _src: src,
      });
    });
  }

  // Kick off the lookup the user just confirmed and clear the pending
  // state. Separate function so the modal's Confirm button and any
  // future keyboard shortcut can share one entry point.
  //
  // Two-stage flow when GPT is enabled:
  //   1st click  → runPlannerForPending() populates planResult; modal
  //                re-renders into preview mode with 3-bucket counts.
  //   2nd click  → actually dispatches the batches, passing plans along.
  // When GPT is disabled, both clicks collapse into the current single-
  // stage behaviour (direct to doLookupBatched).
  async function confirmPendingLookup() {
    const pending = pendingLookup;
    if (!pending) return;

    // GPT mode, first click — run the planner, then stay in the modal.
    if (useGptPlanner && !planResult) {
      await runPlannerForPending();
      return;
    }

    // GPT mode, preview confirmed — split rows by plan strategy and
    // dispatch. The planner's own pre-filter is the source of truth, so
    // ignore the caller's original rows/skippedWithPhone partition.
    if (useGptPlanner && planResult) {
      const { plans, allRows } = planResult;
      const enrichRows = [];
      const enrichPlans = [];
      const fileRows = [];
      const skipRows = [];
      const skipPlans = [];
      for (let i = 0; i < allRows.length; i++) {
        const plan = plans[i] || null;
        const src = allRows[i];
        if (!plan) { enrichRows.push(src); enrichPlans.push(null); continue; }
        if (plan.strategy === "use_file_phone") fileRows.push(src);
        else if (plan.strategy === "skip_no_lead") { skipRows.push(src); skipPlans.push(plan); }
        else { enrichRows.push(src); enrichPlans.push(plan); }
      }
      setPendingLookup(null);
      setPlanResult(null);
      await doLookupBatched(enrichRows, pending.source, {
        skippedWithPhone: fileRows,
        manualReviewRows: skipRows,
        manualReviewPlans: skipPlans,
        plans: enrichPlans,
      });
      return;
    }

    // Non-GPT path — unchanged.
    setPendingLookup(null);
    setPlanResult(null);
    await doLookupBatched(pending.rows, pending.source, {
      skippedWithPhone: pending.skippedWithPhone || [],
    });
  }

  async function handleCSVDrop(file) {
    if (!file) return;
    setApiError("");
    try {
      let parsed;
      if (isSpreadsheetFile(file)) {
        parsed = await parseSpreadsheet(file);
      } else {
        const text = await file.text();
        parsed = parseCSV(text);
      }
      if (!parsed?.rows?.length) {
        setApiError(t("pf_err_no_rows_parsed"));
        return;
      }
      setCsvFile(parsed);
      setColMap(autoDetectCols(parsed.headers || []));
      setShowColMap(false);
    } catch (err) {
      setApiError(t("pf_err_import", String(err?.message || err)));
    }
  }

  function pickCSVFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
    inp.onchange = e => { if (e.target.files[0]) handleCSVDrop(e.target.files[0]); };
    inp.click();
  }

  function exportCSV() {
    if (!activeRun) return;
    const headers = [
      t("pf_csv_hdr_company"),
      t("pf_csv_hdr_contact"),
      t("pf_csv_hdr_building"),
      t("pf_csv_hdr_input_name"),
      t("pf_csv_hdr_input_address"),
      t("pf_csv_hdr_matched_name"),
      t("pf_csv_hdr_matched_address"),
      t("pf_csv_hdr_phone"),
      t("pf_csv_hdr_file_phones"),
      t("pf_csv_hdr_website"),
      t("pf_csv_hdr_source"),
      t("pf_csv_hdr_confidence"),
      t("pf_csv_hdr_status"),
      t("pf_csv_hdr_date"),
    ];
    const body = filteredResults.map(r => [
      r.companyName || "",
      r.leadContact || "",
      r.buildingAddress || r.inputAddress || "",
      r.inputName, r.inputAddress, r.matchedName, r.matchedAddress,
      r.phone, (r.inputPhones || []).join(" | "), r.website, r.source, r.confidence, r.status, r.searchedAt,
    ]);
    const csv = [headers, ...body].map(row => row.map(c => `"${String(c ?? "").replace(/"/g, "\"\"")}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const runDate = (activeRun.createdAt || new Date().toISOString()).slice(0, 10);
    const a = document.createElement("a"); a.href = url; a.download = `${t("pf_csv_download_stem")}-${runDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const filteredResults = useMemo(() => {
    let r = results;
    if (filter.status !== "all") r = r.filter(x => x.status === filter.status);
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      r = r.filter(x => (
        `${x.inputName || ""} ${x.inputAddress || ""} ${x.companyName || ""} ${x.leadContact || ""} ${x.buildingAddress || ""} ${x.matchedName || ""} ${x.phone || ""} ${(x.inputPhones || []).join(" ")} ${x.website || ""}`
      ).toLowerCase().includes(q));
    }
    return r;
  }, [results, filter, debouncedSearch]);

  const exportFoundRows = useMemo(() => (
    filteredResults.filter(r => r.status === "found" && rowHasAnyPhone(r))
  ), [filteredResults]);

  const exportStatusLabel = t("pf_export_status_current");

  const pagedResults = filteredResults.slice(0, page * PAGE_SIZE);
  const FIELD_LABELS = {
    name: t("pf_fl_name"),
    company: t("pf_fl_company"),
    leadContact: t("pf_fl_leadContact"),
    phone: t("pf_fl_phone"),
    address: t("pf_fl_address"),
    city: t("pf_fl_city"),
    province: t("pf_fl_province"),
    postalCode: t("pf_fl_postalCode"),
    country: t("pf_fl_country"),
  };
  const FIELD_HINTS  = {
    name: t("pf_fh_name"),
    company: t("pf_fh_company"),
    leadContact: t("pf_fh_leadContact"),
    phone: t("pf_fh_phone"),
    address: t("pf_fh_address"),
    city: t("pf_fh_city"),
    province: t("pf_fh_province"),
    postalCode: t("pf_fh_postalCode"),
    country: t("pf_fh_country"),
  };

  function confClass(n) { return n >= 80 ? "hi" : n >= 60 ? "mid" : n >= 40 ? "lo" : "zero"; }

  // STATUS_CFG lives in <PhoneResultRow> now — it owns the status pill
  // rendering and its own label strings. Removed from this file along
  // with the i18n sweep.

  // Stable row handlers for <PhoneResultRow memo>. updateActiveRunRows /
  // rerunSingleRow are recreated every render, so we mirror them through
  // refs and hand the row a useCallback that never changes identity — keeps
  // React.memo bails fast even when parent re-renders for unrelated reasons
  // (filter typing, page click, toast, etc).
  const rerunRef = useRef(rerunSingleRow);
  rerunRef.current = rerunSingleRow;
  const updateRowsRef = useRef(updateActiveRunRows);
  updateRowsRef.current = updateActiveRunRows;

  const onRowReview = useCallback((r) => setReviewRow(r), []);
  const onRowRerun = useCallback((r) => rerunRef.current(r), []);
  const onRowDelete = useCallback((r) => {
    updateRowsRef.current(prev => prev.filter(x => x.id !== r.id));
  }, []);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>

      {/* ── Review Modal ───────────────────────────────────────────────── */}
      {reviewRow && (
        <div className="mo" onClick={() => setReviewRow(null)}>
          <div className="mo-box" onClick={e => e.stopPropagation()} style={{maxWidth:560}}>
            <div className="mo-title">{t("pf_review_title")}</div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:14}}>
              {t("pf_review_query")} <strong>{reviewRow.inputName || reviewRow.inputAddress}</strong>
            </div>
            {[
              { name:reviewRow.matchedName, address:reviewRow.matchedAddress, phone:reviewRow.phone, website:reviewRow.website, confidence:reviewRow.confidence },
              ...(reviewRow.candidates || []),
            ].map((c, i) => (
              <div key={i} className={`pf-cand${i===0?" best":""}`}
                onClick={() => {
                  updateActiveRunRows(prev => prev.map(r => r.id === reviewRow.id
                    ? { ...r, matchedName:c.name, matchedAddress:c.address, phone:c.phone, website:c.website, confidence:c.confidence, status:"found" }
                    : r));
                  setReviewRow(null);
                }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                  <span style={{fontWeight:700,fontSize:13}}>{c.name || t("pf_review_anon")}</span>
                  <span className={`pf-conf ${confClass(c.confidence)}`}>{c.confidence}%</span>
                </div>
                <div style={{fontSize:11,color:"var(--text2)"}}>{c.address}</div>
                {c.phone && <div style={{fontSize:12,fontWeight:700,color:"var(--gold)",marginTop:4}}>📞 {c.phone}</div>}
                {c.website && <div style={{fontSize:11,color:"var(--blue)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🌐 {c.website}</div>}
              </div>
            ))}
            <div className="mo-foot">
              <button className="btn btn-danger btn-sm" onClick={() => { updateActiveRunRows(prev => prev.map(r => r.id === reviewRow.id ? { ...r, status:"not_found" } : r)); setReviewRow(null); }}>{t("pf_review_mark_notfound")}</button>
              <button className="btn" onClick={() => setReviewRow(null)}>{t("pf_review_cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column Mapping Modal ──────────────────────────────────────── */}
      {showColMap && csvFile && (
        <div className="mo">
            <div className="mo-box" style={{maxWidth:520,maxHeight:"85vh",overflow:"auto"}}>
            <div className="mo-title">{t("pf_colmap_title")}</div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:14}}>
              {/* The pf_colmap_stats key gives us the full plain-text
                  sentence; here we inline a React-rich version so the
                  row and column counts render in <strong> and the
                  separator glyph renders in <code>. Falling back to
                  the string key would lose that formatting. */}
              <strong>{csvFile.rows.length}</strong>
              {lang === "en" ? " rows · " : " lignes · "}
              <strong>{csvFile.headers.length}</strong>
              {lang === "en" ? " columns detected (separator: " : " colonnes détectées (séparateur : "}
              <code style={{background:"#F0E8D8",padding:"1px 5px",borderRadius:4}}>{csvFile.delim === "\t" ? t("pf_sep_tab") : csvFile.delim}</code>)<br/>
              {t("pf_colmap_hint")}
            </div>
            {Object.entries(FIELD_LABELS).map(([f, lbl]) => (
              <div className="f-row" key={f}>
                <div className="f-lbl">{lbl} <span style={{color:"var(--text3)",fontWeight:400}}>— {FIELD_HINTS[f]}</span></div>
                <select value={colMap[f] || ""} onChange={e => setColMap(m => ({ ...m, [f]: e.target.value }))}>
                  <option value="">{t("pf_colmap_ignore")}</option>
                  {csvFile.headers.map(h => <option key={h} value={h}>{h} {csvFile.rows[0]?.[h] ? t("pf_csv_example", String(csvFile.rows[0][h]).slice(0,30)) : ""}</option>)}
                </select>
              </div>
            ))}
            <div className="mo-foot">
              <button className="btn" onClick={() => setShowColMap(false)}>{t("pf_colmap_close")}</button>
              <button className="btn btn-gold" onClick={() => { setShowColMap(false); }}>{t("pf_colmap_confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pre-flight cost confirmation ──────────────────────────────
          Shows before a CSV batch hits Google Places. Displays a
          midpoint $ estimate + a range, and a call-count breakdown
          so the user knows what they're authorizing. The modal
          blocks on confirmPendingLookup — Cancel closes without
          making any API calls. Backdrop click + Esc also cancel.
          Added after a $100 Places bill burn; cheaper to show a
          dialog than to hope the user never imports too big. */}
      {pendingLookup && (() => {
        // Effective counts: when planResult is populated, we show the
        // planner's 3-bucket split; otherwise we fall back to the row-has-
        // a-phone heuristic built at searchCSV time.
        const stats = planResult?.stats || null;
        const enrichCount = stats ? stats.enrichOwnerPostal : pendingLookup.rows.length;
        const fileCount = stats ? stats.useFilePhone : (pendingLookup.skippedWithPhone || []).length;
        const skipCount = stats ? stats.skipNoLead : 0;
        const est = estimateLookupCost(enrichCount);
        // Flat GPT surcharge: the planner uses gpt-4o-mini and batches
        // 20 rows per call. Rough midpoint: ~$0.35 per 2k rows.
        const gptSurcharge = useGptPlanner ? (pendingLookup.rows.length + (pendingLookup.skippedWithPhone?.length || 0)) * 0.00018 : 0;
        const hasPlan = Boolean(planResult);
        const cancel = () => { setPendingLookup(null); setPlanResult(null); };
        // Primary button label depends on stage:
        //  - GPT on, no plan yet   → "Prévisualiser" / "Preview"
        //  - GPT on, plan computed → "Launch"
        //  - GPT off               → "Launch" (current behavior)
        const primaryLabel = useGptPlanner
          ? (hasPlan ? t("pf_confirm_launch") : (lang === "en" ? "Preview plan" : "Prévisualiser le plan"))
          : t("pf_confirm_launch");
        return (
          <div className="mo" onClick={cancel}>
            <div className="mo-box" style={{maxWidth:520}} onClick={e => e.stopPropagation()}>
              <div className="mo-title">{t("pf_confirm_title")}</div>

              {/* GPT planner checkbox. Kept compact — one line with a tooltip
                  rationale. Disabled while the modal is mid-planning so the
                  user can't flip it halfway through. */}
              <label style={{
                display:"flex",alignItems:"flex-start",gap:8,
                background:"#F3F6FB",border:"1px solid #D6E2F1",borderRadius:8,
                padding:"10px 12px",marginBottom:12,cursor: planningBusy ? "wait" : "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={useGptPlanner}
                  disabled={planningBusy}
                  onChange={(e) => { setUseGptPlanner(e.target.checked); setPlanResult(null); }}
                  style={{marginTop:2}}
                />
                <div style={{fontSize:12,lineHeight:1.5,color:"var(--text)"}}>
                  <div style={{fontWeight:600,marginBottom:2}}>
                    {lang === "en" ? "GPT-optimized lookup" : "Recherche optimisée par GPT"}
                    <span style={{color:"var(--text3)",fontWeight:500,marginLeft:6,fontSize:11}}>
                      {lang === "en" ? "(+$0.35 per 2k rows)" : "(+0,35 $ par 2k lignes)"}
                    </span>
                  </div>
                  <div style={{fontSize:11,color:"var(--text2)"}}>
                    {lang === "en"
                      ? "Uses the owner's postal address + name to find their business before calling Places. Auto-skips rows without enough data to find a lead."
                      : "Utilise l'adresse postale du propriétaire + son nom pour trouver son entreprise avant d'appeler Places. Ignore automatiquement les lignes sans données suffisantes."}
                  </div>
                </div>
              </label>

              <div style={{fontSize:13,lineHeight:1.6,color:"var(--text2)",marginBottom:14}}>
                {lang === "en" ? (
                  <>You are about to enrich <strong style={{color:"var(--text)"}}>{enrichCount}</strong> {enrichCount === 1 ? "row" : "rows"} via Google Places.</>
                ) : (
                  <>Vous êtes sur le point d'enrichir <strong style={{color:"var(--text)"}}>{enrichCount}</strong> {enrichCount === 1 ? "ligne" : "lignes"} via Google Places.</>
                )}
              </div>

              {/* 3-bucket preview appears once the planner has run. Always
                  show the "on file" bucket — it's useful in both modes. */}
              {hasPlan ? (
                <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:8,marginBottom:14}}>
                  <div style={{background:"#E9F7EF",border:"1px solid #BFE3CC",borderRadius:8,padding:"10px 10px"}}>
                    <div style={{fontSize:11,color:"#1A7A3F",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>
                      {lang === "en" ? "On file" : "Au fichier"}
                    </div>
                    <div style={{fontSize:20,fontWeight:700,color:"#1A7A3F"}}>{fileCount}</div>
                    <div style={{fontSize:10,color:"#1A7A3F",marginTop:2}}>
                      {lang === "en" ? "Zero API cost" : "Aucun coût API"}
                    </div>
                  </div>
                  <div style={{background:"#FFF6E5",border:"1px solid #F5E5B0",borderRadius:8,padding:"10px 10px"}}>
                    <div style={{fontSize:11,color:"#8A6A00",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>
                      {lang === "en" ? "To enrich" : "À enrichir"}
                    </div>
                    <div style={{fontSize:20,fontWeight:700,color:"#8A6A00"}}>{enrichCount}</div>
                    <div style={{fontSize:10,color:"#8A6A00",marginTop:2}}>
                      {lang === "en" ? "GPT + Places" : "GPT + Places"}
                    </div>
                  </div>
                  <div style={{background:"#F2F2F2",border:"1px solid #D6D6D6",borderRadius:8,padding:"10px 10px"}}>
                    <div style={{fontSize:11,color:"#555",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>
                      {lang === "en" ? "Manual review" : "À revoir"}
                    </div>
                    <div style={{fontSize:20,fontWeight:700,color:"#333"}}>{skipCount}</div>
                    <div style={{fontSize:10,color:"#555",marginTop:2}}>
                      {lang === "en" ? "Insufficient data" : "Données insuffisantes"}
                    </div>
                  </div>
                </div>
              ) : fileCount > 0 && (
                <div style={{
                  background:"#E9F7EF",border:"1px solid #BFE3CC",borderRadius:8,
                  padding:"10px 12px",marginBottom:14,
                  fontSize:12,lineHeight:1.5,color:"#1A7A3F"
                }}>
                  {lang === "en" ? (
                    <><strong>{fileCount}</strong> {fileCount === 1 ? "row" : "rows"} already have a valid phone number on file — skipped automatically (no API cost). They will be added to the results as-is.</>
                  ) : (
                    <><strong>{fileCount}</strong> {fileCount === 1 ? "ligne a" : "lignes ont"} déjà un numéro de téléphone valide au fichier — ignorées automatiquement (aucun coût API). Elles seront ajoutées aux résultats telles quelles.</>
                  )}
                </div>
              )}

              <div style={{background:"#FAF8F4",border:"1px solid var(--border)",borderRadius:8,padding:"12px 14px",marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                  <div style={{fontSize:12,color:"var(--text2)"}}>{t("pf_confirm_est_label")}</div>
                  <div style={{fontSize:22,fontWeight:700,color:"var(--text)"}}>
                    {formatCost(est.mid + gptSurcharge)}
                  </div>
                </div>
                <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}>
                  {t("pf_confirm_range", formatCost(est.lo + gptSurcharge), formatCost(est.hi + gptSurcharge))}<br/>
                  {t("pf_confirm_calls", Math.round(est.callsLoTextSearch), Math.round(est.callsHiTextSearch), Math.round(est.callsLoDetails), Math.round(est.callsHiDetails))}<br/>
                  {useGptPlanner && (
                    <>
                      {lang === "en"
                        ? `+ GPT planner: ~${formatCost(gptSurcharge)}`
                        : `+ Planificateur GPT : ~${formatCost(gptSurcharge)}`}<br/>
                    </>
                  )}
                  {t("pf_confirm_note")}
                </div>
              </div>

              {apiError && (
                <div style={{background:"#FCE9E6",border:"1px solid #F5C9C2",color:"var(--red)",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12}}>
                  {apiError}
                </div>
              )}

              <div className="mo-foot">
                <button className="btn" onClick={cancel} disabled={planningBusy}>
                  {t("pf_confirm_cancel")}
                </button>
                <button
                  className="btn btn-gold"
                  onClick={confirmPendingLookup}
                  disabled={planningBusy}
                >
                  {planningBusy
                    ? (lang === "en" ? "Planning…" : "Planification…")
                    : primaryLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div style={{background:"var(--card)",borderBottom:"1px solid var(--border)",padding:"14px 22px 0",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{fontSize:22,fontWeight:700,color:"var(--text)"}}>{t("pf_header_title")}</div>
              {dailySpend.rows > 0 && (
                <span
                  title={t("pf_spend_tooltip", dailySpend.rows)}
                  style={{
                    fontSize:11,
                    fontWeight:700,
                    padding:"3px 9px",
                    borderRadius:999,
                    background: dailySpend.estCost >= 50 ? "#FCE9E6" : dailySpend.estCost >= 20 ? "#FFF4DD" : "var(--gold-light)",
                    color: dailySpend.estCost >= 50 ? "var(--red)" : "var(--text)",
                    border: "1px solid",
                    borderColor: dailySpend.estCost >= 50 ? "#F5C9C2" : dailySpend.estCost >= 20 ? "#F5E5B0" : "#E9D9AA",
                    whiteSpace:"nowrap",
                  }}
                >
                  {t("pf_spend_today", dailySpend.rows, formatCost(dailySpend.estCost))}
                </span>
              )}
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{t("pf_header_sub")}</div>
          </div>
          {activeRun && (
            <div style={{display:"flex",gap:8}}>
              <button
                className="btn btn-sm btn-gold"
                onClick={() => exportRunToLeads({ ...activeRun, rows: exportFoundRows })}
                disabled={exportBusy || exportFoundRows.length === 0}
              >
                {exportBusy ? t("pf_export_busy") : t("pf_export_found_btn", exportFoundRows.length)}
              </button>
              {pfPage !== "results" && <button className="btn btn-sm" onClick={() => setPfPage("results")}>{t("pf_view_results")}</button>}
              <button className="btn btn-sm" onClick={exportCSV}>{t("pf_export_csv")}</button>
              <button className="btn btn-danger btn-sm" onClick={clearAllRuns}>{t("pf_clear_all")}</button>
            </div>
          )}
        </div>
        <div className="tabs">
          <button className={`tab${pfPage==="search"?" active":""}`} onClick={() => setPfPage("search")}>{t("pf_tab_search")}</button>
          <button className={`tab${pfPage==="results"?" active":""}`} onClick={() => setPfPage("results")}>{t("pf_tab_results", resultRuns.length)}</button>
        </div>
      </div>

      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:22,display:"flex",flexDirection:"column",gap:14}}>

        {/* ── Progress bar ──────────────────────────────────────────── */}
        {loading && progress && (
          <div className="card" style={{padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>
                {t("pf_processing", progress.done, progress.total)}
              </div>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  stopRef.current = true;
                  // Also abort the current in-flight fetch so the stop is
                  // immediate instead of waiting for the current batch to
                  // finish.
                  if (lookupAbortRef.current) lookupAbortRef.current.abort();
                }}
              >
                {t("pf_stop")}
              </button>
            </div>
            <div style={{height:8,background:"#F0E8D8",borderRadius:999,overflow:"hidden"}}>
              <div style={{height:"100%",background:"var(--gold)",borderRadius:999,width:`${Math.round((progress.done/progress.total)*100)}%`,transition:"width .3s"}} />
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:5,textAlign:"right"}}>
              {t("pf_remaining", Math.round((progress.done/progress.total)*100), Math.round(((progress.total - progress.done) / BATCH_SIZE) * 3))}
            </div>
          </div>
        )}
        {loading && !progress && (
          <div className="status-note" style={{textAlign:"center",padding:18}}>{t("pf_connecting")}</div>
        )}

        {/* ── Search Page ───────────────────────────────────────────── */}
        {pfPage === "search" && (
          <>
            <div className="tabs" style={{paddingLeft:2}}>
              <button className={`tab${pfTab==="manual"?" active":""}`} onClick={() => setPfTab("manual")}>{t("pf_tab_manual")}</button>
              <button className={`tab${pfTab==="csv"?" active":""}`} onClick={() => setPfTab("csv")}>{t("pf_tab_csv")}</button>
            </div>

            {pfTab === "manual" && (
              <div className="card f-card">
                <div className="f-title">{t("pf_manual_section")}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                  {[
                    ["name",    t("pf_field_name"),     t("pf_field_name_ph")],
                    ["address", t("pf_field_address"),  t("pf_field_address_ph")],
                    ["city",    t("pf_field_city"),     t("pf_field_city_ph")],
                    ["province",t("pf_field_province"), t("pf_field_province_ph")],
                    ["postalCode", t("pf_field_postal"), t("pf_field_postal_ph")],
                    ["country", t("pf_field_country"),  t("pf_field_country_ph")],
                  ].map(([field, lbl, ph]) => (
                    <div className="f-row" key={field}>
                      <div className="f-lbl">{lbl}</div>
                      <input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} placeholder={ph} onKeyDown={e => e.key === "Enter" && searchManual()} />
                    </div>
                  ))}
                </div>
                {apiError && <div className="status-note error" style={{marginBottom:8}}>{apiError}</div>}
                <div style={{display:"flex",justifyContent:"flex-end",marginTop:4}}>
                  <button className="btn btn-gold" onClick={searchManual} disabled={loading}>{loading ? t("pf_btn_searching") : t("pf_btn_search")}</button>
                </div>
              </div>
            )}

            {pfTab === "csv" && (
              <div className="card f-card">
                <div className="f-title">{t("pf_csv_section")}</div>
                <div className="pf-drop"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCSVDrop(f); }}
                  onClick={pickCSVFile}>
                  <div style={{fontSize:32,marginBottom:8}}>📂</div>
                  {csvFile
                    ? <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>
                        {/* Inline the stats sentence so the separator can
                            render inside a styled <code>. pf_csv_stats
                            lives as a string for non-JSX callers (tests,
                            csv import toast) but here we split manually. */}
                        {csvFile.rows.length}
                        {lang === "en" ? " rows · " : " lignes · "}
                        {csvFile.headers.length}
                        {lang === "en" ? " columns · separator: " : " colonnes · séparateur : "}
                        <code style={{background:"#F0E8D8",padding:"1px 5px",borderRadius:4}}>{csvFile.delim === "\t" ? t("pf_sep_tab") : csvFile.delim}</code>
                      </div>
                    : <div style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>{t("pf_csv_drop")}</div>}
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{t("pf_csv_hint")}</div>
                </div>
                {csvFile && (
                  <div style={{marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                    <div style={{fontSize:12,color:"var(--text2)"}}>
                      {/* Inline a React-rich version of pf_csv_detected so
                          the row + column counts render in <strong>. */}
                      <strong>{csvFile.rows.length}</strong>{" "}
                      {lang === "en" ? "rows •" : "lignes •"}{" "}
                      <strong>{Object.values(colMap).filter(Boolean).length}</strong>{" "}
                      {lang === "en" ? "columns auto-detected" : "colonnes détectées automatiquement"}
                      {" "}(<button style={{border:"none",background:"none",color:"var(--blue)",fontSize:12,cursor:"pointer",padding:0}} onClick={e => { e.stopPropagation(); setShowColMap(true); }}>{t("pf_csv_advanced_mapping")}</button>)
                    </div>
                    <button className="btn btn-gold" onClick={searchCSV} disabled={loading}>{loading ? t("pf_csv_running") : t("pf_csv_search_n", csvFile.rows.length)}</button>
                  </div>
                )}
                {apiError && <div className="status-note error" style={{marginTop:8}}>{apiError}</div>}
              </div>
            )}

            {!loading && resultRuns.length === 0 && (
              <div className="card empty">
                <div className="empty-ico">📞</div>
                <div className="empty-title">{t("pf_empty_saved_title")}</div>
                <div className="empty-sub">{t("pf_empty_saved_sub")}</div>
              </div>
            )}

            {!loading && resultRuns.length > 0 && (
              <div className="card" style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{fontSize:12,color:"var(--text2)"}}>
                  {/* Render the "last import" sentence inline with a <strong>
                      for the title — pf_last_import exists as a string for
                      other use-sites (toasts) but here we inline for rich
                      formatting. */}
                  {lang === "en" ? "Last import: " : "Dernier import : "}
                  <strong style={{color:"var(--text)"}}>{resultRuns[0].title}</strong>
                  {" · "}{resultRuns[0].totalRows}{" "}{lang === "en" ? "rows" : "lignes"}
                </div>
                <button className="btn btn-gold" onClick={() => { setActiveRunId(resultRuns[0].id); setPfPage("results"); }}>{t("pf_open_results")}</button>
              </div>
            )}
          </>
        )}

        {/* ── Results Page ──────────────────────────────────────────── */}
        {pfPage === "results" && (
          resultRuns.length === 0 ? (
            <div className="card empty">
              <div className="empty-ico">📚</div>
              <div className="empty-title">{t("pf_empty_saved_title")}</div>
              <div className="empty-sub">{t("pf_empty_results_sub")}</div>
              <button className="btn btn-gold" onClick={() => setPfPage("search")}>{t("pf_empty_results_cta")}</button>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"280px minmax(0, 1fr)",gap:14,alignItems:"start"}}>
              <div className="card" style={{overflow:"hidden",display:"flex",flexDirection:"column",minHeight:120}}>
                <div style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",fontSize:11,fontWeight:700,letterSpacing:".4px",textTransform:"uppercase",color:"var(--text3)"}}>
                  {t("pf_saved_imports")}
                </div>
                <div style={{padding:10,display:"flex",flexDirection:"column",gap:8,maxHeight:"calc(100vh - 290px)",overflowY:"auto"}}>
                  {resultRuns.map(run => {
                    const selected = run.id === activeRunId;
                    return (
                      <div key={run.id} style={{display:"flex",gap:6}}>
                        <button
                          className="btn"
                          style={{flex:1,textAlign:"left",padding:"9px 10px",background:selected ? "#F5EDD6" : "#fff",borderColor:selected ? "#E1CC94" : "var(--border)"}}
                          onClick={() => setActiveRunId(run.id)}
                        >
                          <div style={{fontSize:12,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{run.title}</div>
                          <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>
                            {t("pf_rows_found_sub", run.totalRows || 0, run.foundCount || 0)}
                          </div>
                        </button>
                        <button className="btn btn-sm" title={t("pf_rename_title")} onClick={() => askRenameRun(run)}>✎</button>
                        <button className="btn btn-sm btn-danger" onClick={() => { if (window.confirm(t("pf_confirm_delete_run"))) removeRun(run.id); }}>✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:14,minWidth:0}}>
                {activeRun && (
                  <div className="card" style={{padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{activeRun.title}</div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>
                        {t("pf_active_run_summary", formatRunDate(activeRun.createdAt), activeRun.totalRows || 0, activeRun.foundCount || 0)}
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                        {t("pf_export_status_label_prefix")} <strong style={{color:"var(--text2)"}}>{exportStatusLabel}</strong> ({exportFoundRows.length})
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button
                        className="btn btn-sm btn-gold"
                        onClick={() => exportRunToLeads({ ...activeRun, rows: exportFoundRows })}
                        disabled={exportBusy || exportFoundRows.length === 0}
                      >
                        {exportBusy ? t("pf_export_busy") : t("pf_export_found_leads", exportFoundRows.length)}
                      </button>
                      <button className="btn btn-sm" onClick={() => askRenameRun(activeRun)}>{t("pf_rename_btn")}</button>
                      <button className="btn btn-sm" onClick={exportCSV}>{t("pf_export_this_import")}</button>
                    </div>
                  </div>
                )}

                {activeRun && (
                  filteredResults.length > 0 ? (
                    <div className="card" style={{overflow:"hidden"}}>
                      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                        <input ref={searchRef} className="tb-search" style={{width:200}} placeholder={t("pf_filter_ph")} value={searchInput} onChange={e => setSearchInput(e.target.value)} />
                        <select style={{width:"auto",padding:"7px 10px",fontSize:12}} value={filter.status} onChange={e => { setFilter(f => ({ ...f, status:e.target.value })); setPage(1); }}>
                          <option value="all">{t("pf_filter_status_all")}</option>
                          <option value="found">{t("pf_filter_status_found")}</option>
                          <option value="needs_review">{t("pf_filter_status_review")}</option>
                          <option value="multiple_matches">{t("pf_filter_status_multi")}</option>
                          <option value="not_found">{t("pf_filter_status_not_found")}</option>
                        </select>
                        {results.some(r => r.status === "not_found" && r._src) && (
                          <button
                            className="btn btn-sm"
                            onClick={rerunNotFound}
                            disabled={loading}
                            title={t("pf_rerun_not_found_tt")}
                            style={{whiteSpace:"nowrap"}}
                          >
                            {t("pf_rerun_not_found")}
                          </button>
                        )}
                        <span style={{fontSize:11,color:"var(--text3)",marginLeft:"auto"}}>
                          {pagedResults.length < filteredResults.length
                            ? t("pf_shown_of", pagedResults.length, filteredResults.length)
                            : t("pf_results_count", filteredResults.length)}
                          {results.length !== filteredResults.length ? t("pf_total_suffix", results.length) : ""}
                        </span>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table className="pf-tbl">
                          <thead>
                            <tr>
                              <th>{t("pf_th_num")}</th>
                              <th>{t("pf_th_search")}</th>
                              <th>{t("pf_th_match")}</th>
                              <th>{t("pf_th_phone")}</th>
                              <th>{t("pf_th_website")}</th>
                              <th style={{textAlign:"center"}}>{t("pf_th_conf")}</th>
                              <th>{t("pf_th_status")}</th>
                              <th>{t("pf_th_actions")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedResults.map((r, i) => (
                              <PhoneResultRow
                                key={r.id || i}
                                r={r}
                                i={i}
                                loading={loading}
                                onReview={onRowReview}
                                onRerun={onRowRerun}
                                onDelete={onRowDelete}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {pagedResults.length < filteredResults.length && (
                        <div style={{padding:"12px 14px",borderTop:"1px solid var(--border)",textAlign:"center"}}>
                          <button className="btn" onClick={() => setPage(p => p + 1)}>
                            {t("pf_show_more", Math.min(PAGE_SIZE, filteredResults.length - pagedResults.length), filteredResults.length - pagedResults.length)}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="card empty">
                      <div className="empty-ico">📄</div>
                      <div className="empty-title">{t("pf_no_results_title")}</div>
                      <div className="empty-sub">{t("pf_no_results_sub")}</div>
                    </div>
                  )
                )}
              </div>
            </div>
          )
        )}

        {/* ── Toast ────────────────────────────────────────────────── */}
        {toast && (
          <div style={{position:"fixed",bottom:24,right:24,background:"#1A7A3F",color:"#fff",padding:"12px 18px",borderRadius:10,fontWeight:700,fontSize:13,zIndex:999,boxShadow:"0 4px 16px rgba(0,0,0,.2)"}}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

export default PhoneFinder;
