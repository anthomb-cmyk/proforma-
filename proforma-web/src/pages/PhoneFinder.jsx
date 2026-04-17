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

// Rows per API call — keeps POST /api/phone-lookup under the proxy timeout.
const BATCH_SIZE = 10;
// LocalStorage key for the list of saved enrichment runs.
const PF_RUNS_KEY = "pf_runs";
// LocalStorage key for the id of the currently open run.
const PF_ACTIVE_RUN_KEY = "pf_active_run";
// Cap on the number of runs we keep in memory (oldest evicted).
const MAX_PHONE_RUNS = 40;

function PhoneFinder({ onExportFoundToLeads, onOpenLeads }) {
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
    try {
      const stored = JSON.parse(localStorage.getItem(PF_RUNS_KEY) || "[]");
      if (Array.isArray(stored) && stored.length) {
        return stored
          .map((run, idx) => {
            if (!run || typeof run !== "object") return null;
            const rows = Array.isArray(run.rows) ? run.rows.map(normalizeResultRowPhones) : [];
            const createdAt = run.createdAt || new Date().toISOString();
            const fallbackTitle = `Import du ${new Date(createdAt).toLocaleString("fr-CA", { dateStyle:"medium", timeStyle:"short" })}`;
            return {
              id: run.id || `pf_run_${Date.now()}_${idx}`,
              title: run.title || fallbackTitle,
              source: run.source || "csv",
              createdAt,
              totalRows: Number.isFinite(run.totalRows) ? run.totalRows : rows.length,
              foundCount: Number.isFinite(run.foundCount) ? run.foundCount : rows.filter(rowHasAnyPhone).length,
              rows,
            };
          })
          .filter(Boolean)
          .slice(0, MAX_PHONE_RUNS);
      }
    } catch {}
    try {
      const legacy = JSON.parse(localStorage.getItem("pf_results") || "[]");
      if (Array.isArray(legacy) && legacy.length) {
        const rows = legacy.map(normalizeResultRowPhones);
        const createdAt = new Date().toISOString();
        return [{
          id: `pf_run_legacy_${Date.now()}`,
          title: `Historique importé · ${new Date(createdAt).toLocaleString("fr-CA", { dateStyle:"medium", timeStyle:"short" })}`,
          source: "legacy",
          createdAt,
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
  const [filter, setFilter] = useState({ status:"all", search:"" });
  const [reviewRow, setReviewRow] = useState(null);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const stopRef = useRef(false);
  // AbortController for the current phone-lookup batch fetch so the Stop
  // button cancels the in-flight network request instead of only stopping
  // the next batch iteration.
  const lookupAbortRef = useRef(null);
  const PAGE_SIZE = 100;

  const activeRun = useMemo(() => resultRuns.find(run => run.id === activeRunId) || null, [resultRuns, activeRunId]);
  const results = activeRun?.rows || [];

  useEffect(() => {
    try {
      // Strip in-memory-only _src fields before persisting (they contain the full
      // raw row and would bloat localStorage beyond its 5 MB limit for large files).
      const stripped = resultRuns.slice(0, MAX_PHONE_RUNS).map(run => ({
        ...run,
        rows: (run.rows || []).map(({ _src, ...rest }) => rest),
      }));
      localStorage.setItem(PF_RUNS_KEY, JSON.stringify(stripped));
    } catch {}
  }, [resultRuns]);

  useEffect(() => {
    try { localStorage.setItem("pf_results", JSON.stringify(results.slice(0, 2000))); } catch {}
  }, [results]);

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
    setFilter({ status:"all", search:"" });
    setReviewRow(null);
  }, [activeRunId]);

  function formatRunDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("fr-CA", { dateStyle:"medium", timeStyle:"short" });
  }

  function makeRunTitle(source, createdAt = new Date().toISOString()) {
    const stamp = formatRunDate(createdAt);
    if (source === "manual") return `Recherche manuelle · ${stamp}`;
    return `Import CSV · ${stamp}`;
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
    const next = window.prompt("Nouveau titre pour cet import :", run.title || "");
    if (next === null) return;
    const ok = renameRun(run.id, next);
    if (!ok) {
      setToast("Le titre ne peut pas être vide.");
      setTimeout(() => setToast(""), 3500);
    }
  }

  function clearAllRuns() {
    if (!window.confirm("Effacer tous les imports sauvegardés ?")) return;
    setResultRuns([]);
    setActiveRunId(null);
    setReviewRow(null);
    setFilter({ status:"all", search:"" });
    setPage(1);
    setPfPage("search");
  }

  async function exportRunToLeads(run = activeRun) {
    if (!run) return;
    const rowsToExport = (run.rows || []).filter(rowHasAnyPhone);
    if (!rowsToExport.length) {
      setToast("Aucun numéro trouvé à exporter.");
      setTimeout(() => setToast(""), 3500);
      return;
    }
    if (typeof onExportFoundToLeads !== "function") {
      setToast("Export vers Leads indisponible.");
      setTimeout(() => setToast(""), 3500);
      return;
    }

    setExportBusy(true);
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
        if (added > 0) parts.push(`${added} nouveau${added > 1 ? "x" : ""}`);
        if (updated > 0) parts.push(`${updated} enrichi${updated > 1 ? "s" : ""}`);
        if (skipped > 0) parts.push(`${skipped} inchangé${skipped > 1 ? "s" : ""}`);
        setToast(`✅ Leads mis à jour: ${parts.join(" · ")} · aucune donnée supprimée`);
        if (typeof onOpenLeads === "function") {
          setTimeout(() => onOpenLeads(), 250);
        }
      } else {
        setToast("Tous les numéros trouvés sont déjà dans Leads.");
      }
    } catch (err) {
      setToast(`Export impossible: ${String(err?.message || err)}`);
    } finally {
      setExportBusy(false);
      setTimeout(() => setToast(""), 5000);
    }
  }

  function normalizeHeaderKey(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) return { headers:[], rows:[] };
    // Auto-detect delimiter: semicolon (French Excel), tab, or comma
    const first = lines[0];
    const counts = { ",": (first.match(/,/g)||[]).length, ";": (first.match(/;/g)||[]).length, "\t": (first.match(/\t/g)||[]).length };
    const delim = counts[";"] >= counts[","] && counts[";"] >= counts["\t"] ? ";"
                : counts["\t"] >= counts[","] ? "\t"
                : ",";
    const parseLine = line => {
      const res = []; let cur = ""; let inQ = false;
      for (const c of line) {
        if (c === "\"") { inQ = !inQ; continue; }
        if (c === delim && !inQ) { res.push(cur.trim()); cur = ""; continue; }
        cur += c;
      }
      res.push(cur.trim());
      return res;
    };
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).filter(l => l.trim()).map(l => {
      const vals = parseLine(l);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
    });
    return { headers, rows, delim };
  }

  function parseSpreadsheet(file) {
    return new Promise((resolve, reject) => {
      const XLSX = window.XLSX;
      if (!XLSX) { reject(new Error("Module Excel non chargé.")); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const firstSheet = wb.SheetNames[0];
          if (!firstSheet) throw new Error("Aucune feuille trouvée.");
          const matrix = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, defval: "" });
          if (!Array.isArray(matrix) || !matrix.length) throw new Error("Le fichier est vide.");
          const rawHeaders = Array.isArray(matrix[0]) ? matrix[0] : [];
          const dedupe = {};
          const headers = rawHeaders.map((h, i) => {
            let base = String(h || `Colonne ${i + 1}`).trim();
            if (!base) base = `Colonne ${i + 1}`;
            const seen = dedupe[base] || 0;
            dedupe[base] = seen + 1;
            return seen ? `${base} (${seen + 1})` : base;
          });
          const rows = matrix
            .slice(1)
            .map(vals => Object.fromEntries(headers.map((h, i) => [h, String(vals?.[i] ?? "").trim()])))
            .filter(row => Object.values(row).some(v => String(v).trim()));
          resolve({ headers, rows, delim: `XLSX · ${firstSheet}` });
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function isSpreadsheetFile(file) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();
    return /\.xlsx?$/.test(name) || type.includes("spreadsheetml") || type.includes("excel");
  }

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
        statusLabel: status === "found" ? "Trouvé" : "Non trouvé",
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
      if (!data.ok) { setApiError(data.error || "Erreur serveur"); return; }
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
      setToast(updated.status === "found" ? "🔄 Relancé · numéro trouvé !" : "🔄 Relancé · toujours introuvable");
      setTimeout(() => setToast(""), 4000);
    } catch (err) {
      setApiError(`Erreur: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Re-run the lookup for ALL not_found rows in the active run.
  async function rerunNotFound() {
    const notFoundRows = results.filter(r => r.status === "not_found" && r._src);
    if (!notFoundRows.length) {
      setToast("Aucun résultat non trouvé relançable (fichier non rechargé depuis la session courante).");
      setTimeout(() => setToast(""), 5000);
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
        if (!data.ok) { setApiError(data.error || "Erreur serveur"); break; }
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
        setApiError(`Erreur réseau (lot ${Math.floor(i / BATCH_SIZE) + 1}): ${err.message}`);
        break;
      }
    }
    updateActiveRunRows(prev => prev.map(r => updatedById.has(r.id) ? updatedById.get(r.id) : r));
    const newlyFound = [...updatedById.values()].filter(r => r.status === "found").length;
    setToast(`🔄 ${done} relancés · ${newlyFound} nouveau${newlyFound !== 1 ? "x" : ""} numéro${newlyFound !== 1 ? "s" : ""} trouvé${newlyFound !== 1 ? "s" : ""}`);
    setTimeout(() => setToast(""), 6000);
    setLoading(false);
    setProgress(null);
  }

  // Send rows in small batches so each request completes in < 5s (no proxy timeout)
  async function doLookupBatched(allRows, source = "csv") {
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

    let done = 0;
    let added = 0;
    let runRows = [];

    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      if (stopRef.current) break;
      const batch = allRows.slice(i, i + BATCH_SIZE);
      const controller = new AbortController();
      lookupAbortRef.current = controller;
      try {
        const resp = await fetch("/api/phone-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
          signal: controller.signal,
        });
        const data = await resp.json();
        if (!data.ok) { setApiError(data.error || "Erreur serveur"); break; }
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
        setApiError(`Erreur réseau (lot ${Math.floor(i / BATCH_SIZE) + 1}): ${err.message}`);
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

    if (done > 0) {
      const finalFound = cappedRows.filter(rowHasAnyPhone).length;
      setToast(`✅ ${done} lignes traitées · ${finalFound} numéros trouvés`);
      setTimeout(() => setToast(""), 6000);
      setPfPage("results");
    } else {
      setResultRuns(prev => prev.filter(r => r.id !== runId));
      setPfPage("search");
    }
  }

  async function searchManual() {
    const lookupName = firstBusinessLookupName(form.name);
    if (!lookupName && !form.address) { setApiError("Entrez un nom d'entreprise ou une adresse."); return; }
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
    if (!rows.length) { setApiError("Aucune ligne exploitable dans ce fichier."); return; }
    await doLookupBatched(rows, "csv");
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
        setApiError("Le fichier ne contient pas de lignes importables.");
        return;
      }
      setCsvFile(parsed);
      setColMap(autoDetectCols(parsed.headers || []));
      setShowColMap(false);
    } catch (err) {
      setApiError(`Import impossible: ${String(err?.message || err)}`);
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
    const headers = ["Entreprise", "Contact", "Bâtiment", "Nom saisi", "Adresse saisie", "Nom trouvé", "Adresse trouvée", "Téléphone trouvé", "Téléphones fichier", "Site web", "Source", "Confiance %", "Statut", "Date"];
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
    const a = document.createElement("a"); a.href = url; a.download = `recherche-tel-${runDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const filteredResults = useMemo(() => {
    let r = results;
    if (filter.status !== "all") r = r.filter(x => x.status === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      r = r.filter(x => (
        `${x.inputName || ""} ${x.inputAddress || ""} ${x.companyName || ""} ${x.leadContact || ""} ${x.buildingAddress || ""} ${x.matchedName || ""} ${x.phone || ""} ${(x.inputPhones || []).join(" ")} ${x.website || ""}`
      ).toLowerCase().includes(q));
    }
    return r;
  }, [results, filter]);

  const exportFoundRows = useMemo(() => (
    filteredResults.filter(r => r.status === "found" && rowHasAnyPhone(r))
  ), [filteredResults]);

  const exportStatusLabel = "Trouvé uniquement (filtre affiché)";

  const pagedResults = filteredResults.slice(0, page * PAGE_SIZE);
  const FIELD_LABELS = {
    name:"Nom de recherche",
    company:"Entreprise / Organisation",
    leadContact:"Contact / Propriétaire",
    phone:"Téléphone (déjà connu)",
    address:"Adresse immeuble",
    city:"Ville",
    province:"Province",
    postalCode:"Code postal",
    country:"Pays",
  };
  const FIELD_HINTS  = {
    name:"optionnel, utilisé pour la recherche Places",
    company:"optionnel, prioritaire pour la recherche si présent",
    leadContact:"optionnel, conservé pour savoir qui appeler",
    phone:"optionnel, ajouté au lead à l'export",
    address:"très recommandé",
    city:"optionnel",
    province:"optionnel",
    postalCode:"optionnel",
    country:"optionnel",
  };

  function confClass(n) { return n >= 80 ? "hi" : n >= 60 ? "mid" : n >= 40 ? "lo" : "zero"; }

  const STATUS_CFG = {
    found:            { label:"Trouvé",         cls:"found" },
    needs_review:     { label:"À vérifier",     cls:"needs_review" },
    multiple_matches: { label:"Choix multiple", cls:"multiple_matches" },
    not_found:        { label:"Non trouvé",     cls:"not_found" },
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>

      {/* ── Review Modal ───────────────────────────────────────────────── */}
      {reviewRow && (
        <div className="mo" onClick={() => setReviewRow(null)}>
          <div className="mo-box" onClick={e => e.stopPropagation()} style={{maxWidth:560}}>
            <div className="mo-title">Choisir le bon résultat</div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:14}}>
              Recherche : <strong>{reviewRow.inputName || reviewRow.inputAddress}</strong>
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
                  <span style={{fontWeight:700,fontSize:13}}>{c.name || "(sans nom)"}</span>
                  <span className={`pf-conf ${confClass(c.confidence)}`}>{c.confidence}%</span>
                </div>
                <div style={{fontSize:11,color:"var(--text2)"}}>{c.address}</div>
                {c.phone && <div style={{fontSize:12,fontWeight:700,color:"var(--gold)",marginTop:4}}>📞 {c.phone}</div>}
                {c.website && <div style={{fontSize:11,color:"var(--blue)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🌐 {c.website}</div>}
              </div>
            ))}
            <div className="mo-foot">
              <button className="btn btn-danger btn-sm" onClick={() => { updateActiveRunRows(prev => prev.map(r => r.id === reviewRow.id ? { ...r, status:"not_found" } : r)); setReviewRow(null); }}>Marquer introuvable</button>
              <button className="btn" onClick={() => setReviewRow(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column Mapping Modal ──────────────────────────────────────── */}
      {showColMap && csvFile && (
        <div className="mo">
            <div className="mo-box" style={{maxWidth:520,maxHeight:"85vh",overflow:"auto"}}>
            <div className="mo-title">Mapper les colonnes d'import</div>
            <div style={{fontSize:12,color:"var(--text2)",marginBottom:14}}>
              <strong>{csvFile.rows.length}</strong> lignes · <strong>{csvFile.headers.length}</strong> colonnes détectées (séparateur : <code style={{background:"#F0E8D8",padding:"1px 5px",borderRadius:4}}>{csvFile.delim === "\t" ? "TAB" : csvFile.delim}</code>)<br/>
              Assignez vos colonnes (adresse, entreprise, contact). L'adresse immeuble est recommandée pour une recherche fiable.
            </div>
            {Object.entries(FIELD_LABELS).map(([f, lbl]) => (
              <div className="f-row" key={f}>
                <div className="f-lbl">{lbl} <span style={{color:"var(--text3)",fontWeight:400}}>— {FIELD_HINTS[f]}</span></div>
                <select value={colMap[f] || ""} onChange={e => setColMap(m => ({ ...m, [f]: e.target.value }))}>
                  <option value="">— Ignorer —</option>
                  {csvFile.headers.map(h => <option key={h} value={h}>{h} {csvFile.rows[0]?.[h] ? `→ ex: "${String(csvFile.rows[0][h]).slice(0,30)}"` : ""}</option>)}
                </select>
              </div>
            ))}
            <div className="mo-foot">
              <button className="btn" onClick={() => setShowColMap(false)}>Fermer</button>
              <button className="btn btn-gold" onClick={() => { setShowColMap(false); }}>Confirmer le mappage</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div style={{background:"var(--card)",borderBottom:"1px solid var(--border)",padding:"14px 22px 0",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <div style={{fontSize:22,fontWeight:700,color:"var(--text)"}}>Recherche de Numéros</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>Google Places · imports sauvegardés localement</div>
          </div>
          {activeRun && (
            <div style={{display:"flex",gap:8}}>
              <button
                className="btn btn-sm btn-gold"
                onClick={() => exportRunToLeads({ ...activeRun, rows: exportFoundRows })}
                disabled={exportBusy || exportFoundRows.length === 0}
              >
                {exportBusy ? "Export…" : `⇢ Leads trouvés (${exportFoundRows.length})`}
              </button>
              {pfPage !== "results" && <button className="btn btn-sm" onClick={() => setPfPage("results")}>Voir résultats</button>}
              <button className="btn btn-sm" onClick={exportCSV}>⬇ Exporter CSV</button>
              <button className="btn btn-danger btn-sm" onClick={clearAllRuns}>Vider</button>
            </div>
          )}
        </div>
        <div className="tabs">
          <button className={`tab${pfPage==="search"?" active":""}`} onClick={() => setPfPage("search")}>🔎 Recherche</button>
          <button className={`tab${pfPage==="results"?" active":""}`} onClick={() => setPfPage("results")}>📚 Résultats ({resultRuns.length})</button>
        </div>
      </div>

      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:22,display:"flex",flexDirection:"column",gap:14}}>

        {/* ── Progress bar ──────────────────────────────────────────── */}
        {loading && progress && (
          <div className="card" style={{padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>
                ⏳ {progress.done} / {progress.total} lignes traitées
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
                ⏹ Arrêter
              </button>
            </div>
            <div style={{height:8,background:"#F0E8D8",borderRadius:999,overflow:"hidden"}}>
              <div style={{height:"100%",background:"var(--gold)",borderRadius:999,width:`${Math.round((progress.done/progress.total)*100)}%`,transition:"width .3s"}} />
            </div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:5,textAlign:"right"}}>
              {Math.round((progress.done/progress.total)*100)}% · ~{Math.round(((progress.total - progress.done) / BATCH_SIZE) * 3)}s restantes
            </div>
          </div>
        )}
        {loading && !progress && (
          <div className="status-note" style={{textAlign:"center",padding:18}}>⏳ Connexion à Google Places…</div>
        )}

        {/* ── Search Page ───────────────────────────────────────────── */}
        {pfPage === "search" && (
          <>
            <div className="tabs" style={{paddingLeft:2}}>
              <button className={`tab${pfTab==="manual"?" active":""}`} onClick={() => setPfTab("manual")}>🔍 Recherche manuelle</button>
              <button className={`tab${pfTab==="csv"?" active":""}`} onClick={() => setPfTab("csv")}>📂 Import CSV / XLSX</button>
            </div>

            {pfTab === "manual" && (
              <div className="card f-card">
                <div className="f-title">Informations de recherche</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                  {[
                    ["name","Nom de l'entreprise","Ex: Dépanneur Bélanger"],
                    ["address","Adresse","Ex: 320 rue Bouchard"],
                    ["city","Ville","Ex: Saint-Jean-sur-Richelieu"],
                    ["province","Province","Ex: Québec"],
                    ["postalCode","Code postal","Ex: J3B 6N5"],
                    ["country","Pays","Canada"],
                  ].map(([field, lbl, ph]) => (
                    <div className="f-row" key={field}>
                      <div className="f-lbl">{lbl}</div>
                      <input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} placeholder={ph} onKeyDown={e => e.key === "Enter" && searchManual()} />
                    </div>
                  ))}
                </div>
                {apiError && <div className="status-note error" style={{marginBottom:8}}>{apiError}</div>}
                <div style={{display:"flex",justifyContent:"flex-end",marginTop:4}}>
                  <button className="btn btn-gold" onClick={searchManual} disabled={loading}>{loading ? "Recherche…" : "🔍 Rechercher"}</button>
                </div>
              </div>
            )}

            {pfTab === "csv" && (
              <div className="card f-card">
                <div className="f-title">Import CSV / XLSX</div>
                <div className="pf-drop"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCSVDrop(f); }}
                  onClick={pickCSVFile}>
                  <div style={{fontSize:32,marginBottom:8}}>📂</div>
                  {csvFile
                    ? <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{csvFile.rows.length} lignes · {csvFile.headers.length} colonnes · séparateur : <code style={{background:"#F0E8D8",padding:"1px 5px",borderRadius:4}}>{csvFile.delim === "\t" ? "TAB" : csvFile.delim}</code></div>
                    : <div style={{fontSize:13,fontWeight:700,color:"var(--text2)"}}>Glissez un CSV/XLSX ou cliquez pour choisir</div>}
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>Colonnes utiles : adresse immeuble, entreprise, nom complet, ville, province, code postal</div>
                </div>
                {csvFile && (
                  <div style={{marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                    <div style={{fontSize:12,color:"var(--text2)"}}>
                      <strong>{csvFile.rows.length}</strong> lignes •{" "}
                      <strong>{Object.values(colMap).filter(Boolean).length}</strong> colonnes détectées automatiquement
                      {" "}(<button style={{border:"none",background:"none",color:"var(--blue)",fontSize:12,cursor:"pointer",padding:0}} onClick={e => { e.stopPropagation(); setShowColMap(true); }}>mappage avancé (optionnel)</button>)
                    </div>
                    <button className="btn btn-gold" onClick={searchCSV} disabled={loading}>{loading ? "Recherche en cours…" : `🔍 Rechercher ${csvFile.rows.length} lignes`}</button>
                  </div>
                )}
                {apiError && <div className="status-note error" style={{marginTop:8}}>{apiError}</div>}
              </div>
            )}

            {!loading && resultRuns.length === 0 && (
              <div className="card empty">
                <div className="empty-ico">📞</div>
                <div className="empty-title">Aucun import sauvegardé</div>
                <div className="empty-sub">Lancez une recherche manuelle ou un import CSV. Chaque import sera enregistré dans l'onglet Résultats avec une date.</div>
              </div>
            )}

            {!loading && resultRuns.length > 0 && (
              <div className="card" style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{fontSize:12,color:"var(--text2)"}}>
                  Dernier import : <strong style={{color:"var(--text)"}}>{resultRuns[0].title}</strong> · {resultRuns[0].totalRows} lignes
                </div>
                <button className="btn btn-gold" onClick={() => { setActiveRunId(resultRuns[0].id); setPfPage("results"); }}>Ouvrir les résultats</button>
              </div>
            )}
          </>
        )}

        {/* ── Results Page ──────────────────────────────────────────── */}
        {pfPage === "results" && (
          resultRuns.length === 0 ? (
            <div className="card empty">
              <div className="empty-ico">📚</div>
              <div className="empty-title">Aucun import sauvegardé</div>
              <div className="empty-sub">Retournez dans l'onglet Recherche pour lancer une recherche. Les résultats seront sauvegardés automatiquement avec la date.</div>
              <button className="btn btn-gold" onClick={() => setPfPage("search")}>Aller à la recherche</button>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"280px minmax(0, 1fr)",gap:14,alignItems:"start"}}>
              <div className="card" style={{overflow:"hidden",display:"flex",flexDirection:"column",minHeight:120}}>
                <div style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",fontSize:11,fontWeight:700,letterSpacing:".4px",textTransform:"uppercase",color:"var(--text3)"}}>
                  Imports sauvegardés
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
                            {run.totalRows || 0} lignes · {run.foundCount || 0} trouvés
                          </div>
                        </button>
                        <button className="btn btn-sm" title="Renommer" onClick={() => askRenameRun(run)}>✎</button>
                        <button className="btn btn-sm btn-danger" onClick={() => { if (window.confirm("Supprimer cet import sauvegardé ?")) removeRun(run.id); }}>✕</button>
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
                        {formatRunDate(activeRun.createdAt)} · {activeRun.totalRows || 0} lignes · {activeRun.foundCount || 0} numéros trouvés
                      </div>
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                        Export vers Leads: <strong style={{color:"var(--text2)"}}>{exportStatusLabel}</strong> ({exportFoundRows.length})
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button
                        className="btn btn-sm btn-gold"
                        onClick={() => exportRunToLeads({ ...activeRun, rows: exportFoundRows })}
                        disabled={exportBusy || exportFoundRows.length === 0}
                      >
                        {exportBusy ? "Export…" : `⇢ Exporter ${exportFoundRows.length} leads trouvés`}
                      </button>
                      <button className="btn btn-sm" onClick={() => askRenameRun(activeRun)}>✎ Renommer</button>
                      <button className="btn btn-sm" onClick={exportCSV}>⬇ Exporter cet import</button>
                    </div>
                  </div>
                )}

                {activeRun && (
                  filteredResults.length > 0 ? (
                    <div className="card" style={{overflow:"hidden"}}>
                      <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                        <input className="tb-search" style={{width:200}} placeholder="Filtrer les résultats…" value={filter.search} onChange={e => { setFilter(f => ({ ...f, search:e.target.value })); setPage(1); }} />
                        <select style={{width:"auto",padding:"7px 10px",fontSize:12}} value={filter.status} onChange={e => { setFilter(f => ({ ...f, status:e.target.value })); setPage(1); }}>
                          <option value="all">Tous les statuts</option>
                          <option value="found">Trouvé</option>
                          <option value="needs_review">À vérifier</option>
                          <option value="multiple_matches">Choix multiple</option>
                          <option value="not_found">Non trouvé</option>
                        </select>
                        {results.some(r => r.status === "not_found" && r._src) && (
                          <button
                            className="btn btn-sm"
                            onClick={rerunNotFound}
                            disabled={loading}
                            title="Relancer la recherche Google Places pour toutes les lignes non trouvées dans cette session"
                            style={{whiteSpace:"nowrap"}}
                          >
                            🔄 Relancer non trouvés
                          </button>
                        )}
                        <span style={{fontSize:11,color:"var(--text3)",marginLeft:"auto"}}>
                          {pagedResults.length < filteredResults.length
                            ? `${pagedResults.length} affichés sur ${filteredResults.length}`
                            : `${filteredResults.length} résultat${filteredResults.length !== 1 ? "s" : ""}`}
                          {results.length !== filteredResults.length ? ` (total: ${results.length})` : ""}
                        </span>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table className="pf-tbl">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Recherche</th>
                              <th>Correspondance trouvée</th>
                              <th>Téléphone</th>
                              <th>Site web</th>
                              <th style={{textAlign:"center"}}>Conf.</th>
                              <th>Statut</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedResults.map((r, i) => {
                              const sc = STATUS_CFG[r.status] || STATUS_CFG.not_found;
                              const hasAlts = (r.status === "needs_review" || r.status === "multiple_matches") && r.candidates?.length > 0;
                              const filePhoneKeys = new Set(mergePhoneLists(r.fileInputPhones).map(normalizePhoneKey).filter(Boolean));
                              const onlinePhoneKeys = new Set(mergePhoneLists(r.onlinePhones).map(normalizePhoneKey).filter(Boolean));
                              const pjPhoneKeys = new Set(mergePhoneLists(r.pjDirectoryPhones || r.directoryPhones).map(normalizePhoneKey).filter(Boolean));
                              const c411PhoneKeys = new Set(mergePhoneLists(r.c411DirectoryPhones || []).map(normalizePhoneKey).filter(Boolean));
                              // filePhoneColumns is a { normalizedKey → rawColumnName } map sent by
                              // the server. When present, show the exact Excel column (e.g.
                              // "Propriétaire2_Téléphone"). Fall back to "fichier" for old results.
                              const filePhoneColumns = r.filePhoneColumns || {};
                              const prettyColName = (colName) =>
                                colName
                                  .replace(/Propri[eé]taire(\d+)[_\s]?[Tt][eé]l[eé]phone/i, "Prop.$1 Tél.")
                                  .replace(/[_\s]T[eé]l[eé]phone$/i, " Tél.")
                                  .replace(/_/g, " ")
                                  .replace(/\s+/g, " ")
                                  .trim();
                              const sourceLabelForPhone = (phone) => {
                                const key = normalizePhoneKey(phone);
                                if (!key) return "";
                                const sources = [];
                                const colName = filePhoneColumns[key];
                                if (colName) {
                                  sources.push(prettyColName(colName));
                                } else if (filePhoneKeys.has(key)) {
                                  sources.push("fichier");
                                }
                                if (onlinePhoneKeys.has(key)) sources.push("Google Places");
                                if (pjPhoneKeys.has(key)) sources.push("Pages Jaunes");
                                if (c411PhoneKeys.has(key)) sources.push("411.ca");
                                return sources.join(" + ");
                              };
                              const listedPhones = mergePhoneLists(r.inputPhones);
                              const primaryPhone = r.phone || listedPhones[0] || "";
                              const primaryPhoneSource = primaryPhone ? sourceLabelForPhone(primaryPhone) : "";
                              return (
                                <tr key={r.id || i}>
                                  <td style={{color:"var(--text3)",fontSize:11,width:36}}>{i+1}</td>
                                  <td className="pf-input-col">
                                    {(r.companyName || r.inputName) && <div className="pf-cell-name">{r.companyName || r.inputName}</div>}
                                    {(r.buildingAddress || r.inputAddress) && <div className="pf-cell-addr">🏢 {r.buildingAddress || r.inputAddress}</div>}
                                    {r.utilisation && <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>🏷 {r.utilisation}</div>}
                                    {r.leadContact && <div style={{fontSize:10,color:"var(--text2)",marginTop:2}}>👤 {r.leadContact}</div>}
                                    {listedPhones.length > 0 && (
                                      <div style={{fontSize:10,color:"var(--text2)",marginTop:2}}>
                                        {listedPhones.map(phone => {
                                          const src = sourceLabelForPhone(phone);
                                          return `📇 ${phone}${src ? ` · ${src}` : ""}`;
                                        }).join("  ")}
                                      </div>
                                    )}
                                    {r.error && <div style={{fontSize:10,color:"var(--red)",marginTop:2}} title={r.error}>⚠ {r.error.slice(0,60)}</div>}
                                  </td>
                                  <td className="pf-match-col">
                                    {r.matchedName    && <div className="pf-cell-name">{r.matchedName}</div>}
                                    {r.matchedAddress && <div className="pf-cell-addr">{r.matchedAddress}</div>}
                                    {!r.matchedName && !r.matchedAddress && <span style={{color:"var(--text3)"}}>—</span>}
                                  </td>
                                  <td>
                                    {r.phone
                                      ? <span className="pf-phone" onClick={() => navigator.clipboard?.writeText(r.phone)} title="Copier">📞 {r.phone}</span>
                                      : (listedPhones.length > 0
                                        ? <span className="pf-phone" onClick={() => navigator.clipboard?.writeText(listedPhones.join(" / "))} title="Copier">📇 {listedPhones[0]}</span>
                                        : <span style={{color:"var(--text3)"}}>—</span>)}
                                    {primaryPhoneSource && (
                                      <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>📍 {primaryPhoneSource}</div>
                                    )}
                                  </td>
                                  <td className="pf-web-col">
                                    {r.website
                                      ? <a href={r.website} target="_blank" rel="noopener noreferrer" style={{color:"var(--blue)",fontSize:11,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.website.replace(/^https?:\/\/(www\.)?/,"")}</a>
                                      : <span style={{color:"var(--text3)"}}>—</span>}
                                  </td>
                                  <td style={{textAlign:"center"}}>
                                    <span className={`pf-conf ${confClass(r.confidence)}`}>{r.confidence}%</span>
                                  </td>
                                  <td><span className={`pf-status ${sc.cls}`}>{sc.label}</span></td>
                                  <td>
                                    <div style={{display:"flex",gap:4,flexWrap:"nowrap"}}>
                                      {hasAlts && <button className="btn btn-sm btn-gold" onClick={() => setReviewRow(r)}>Choisir</button>}
                                      {r.status === "not_found" && r._src && (
                                        <button
                                          className="btn btn-sm"
                                          onClick={() => rerunSingleRow(r)}
                                          disabled={loading}
                                          title="Relancer la recherche pour cette ligne"
                                        >
                                          🔄
                                        </button>
                                      )}
                                      {(r.phone || (Array.isArray(r.inputPhones) && r.inputPhones.length > 0)) && (
                                        <button
                                          className="btn btn-sm"
                                          onClick={() => navigator.clipboard?.writeText(mergePhoneLists(r.phone, r.inputPhones).join(" / "))}
                                          title="Copier"
                                        >
                                          📋
                                        </button>
                                      )}
                                      <button className="btn btn-sm btn-danger" onClick={() => updateActiveRunRows(prev => prev.filter(x => x.id !== r.id))}>✕</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {pagedResults.length < filteredResults.length && (
                        <div style={{padding:"12px 14px",borderTop:"1px solid var(--border)",textAlign:"center"}}>
                          <button className="btn" onClick={() => setPage(p => p + 1)}>
                            Afficher {Math.min(PAGE_SIZE, filteredResults.length - pagedResults.length)} de plus ({filteredResults.length - pagedResults.length} restants)
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="card empty">
                      <div className="empty-ico">📄</div>
                      <div className="empty-title">Aucun résultat dans cet import</div>
                      <div className="empty-sub">Cet import existe mais ne contient pas de lignes affichables avec le filtre actuel.</div>
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
