// Leads page — owner-grouped view (1 mailing address = 1 Propriétaire).
// This module was formerly `OwnersManager` and is now the single rendering
// surface for the "Leads" sidebar entry; the flat per-property LeadsManager
// has been retired. See App.js: view === "leads" → <OwnersManager />.
//
// Layout:
//   • Thin top bar: title + ⋯ overflow menu (Import rôle, Enrichir, Test 100)
//   • Search + Stage filter always visible below top bar
//   • Filtres link expands: Source, Tri (secondary)
//   • Left column: owner list (fills remaining height)
//   • Right column: owner fiche (full-screen overlay on mobile)
//   • FAB bottom-right for role import

import { useMemo, useState, useRef, useCallback } from "react";
import useFocusHotkey from "../lib/useFocusHotkey.js";
import useDebouncedValue from "../lib/useDebouncedValue.js";
import useEscapeKey from "../lib/useEscapeKey.js";
import { describeOwnerKey } from "../lib/ownerKey.js";
import {
  ownersToLookupRows,
  applyLookupResultsToOwners,
  ensureBuildingFinances,
  computeBuildingNOI,
  computeBuildingTotalUnits,
} from "../lib/ownerGrouping.js";
import { normalizePhoneKey } from "../lib/phoneUtils.js";
import { parseRoleXlsx, buildOwnersAndLeadsFromRole } from "../lib/roleImport.js";
import { estimateLookupCost, formatCost } from "../lib/phoneLookupCost.js";
import { loadTodaySpend, recordBatch } from "../lib/dailySpendTracker.js";
import VoiceDictation from "../components/VoiceDictation.jsx";
import { WarningIcon, HourglassIcon, PhoneIcon, MapPinIcon } from "../components/Icons.jsx";

const BATCH_SIZE = 10;
const DAILY_SPEND_CAP_USD = 50;
const TEST_BATCH_SIZE = 100;

const STAGES = [
  { id: "new",       tkey: "stage_new",       color: "#6B6B6B", bg: "#ECECEC" },
  { id: "to_call",   tkey: "stage_to_call",   color: "#C9A84C", bg: "#F5EDD6" },
  { id: "contacted", tkey: "stage_contacted", color: "#2563EB", bg: "#E0EAFF" },
  { id: "qualified", tkey: "stage_qualified", color: "#2D8C4E", bg: "#E0F4E6" },
  { id: "converted", tkey: "stage_converted", color: "#2D8C4E", bg: "#D0ECD9" },
  { id: "lost",      tkey: "stage_lost",      color: "#C0392B", bg: "#FCE9E6" },
];

function stageCfg(id) {
  return STAGES.find(s => s.id === id) || STAGES[0];
}

const SOURCE_CFG = {
  Excel:    { tkey: "src_excel",    bg: "#ECECEC", color: "#6B6B6B" },
  Places:   { tkey: "src_places",   bg: "#F5EDD6", color: "#8D742D" },
  Manual:   { tkey: "src_manual",   bg: "#E0EAFF", color: "#2563EB" },
  Migrated: { tkey: "src_migrated", bg: "#F0EDE3", color: "#7B7B7B" },
};

// Call-outcome buttons that appear under "Marquer appel maintenant".
// Each entry sets owner.callStatus + lastCallAt and appends a dated
// note. The `id` values match LeadsManager's CALL_STATUS_CFG keys so
// downstream filters/badges keep working.
const CALL_OUTCOMES = [
  { id: "connected",    label: "Rejoint",       note: "Appel rejoint.",          bg: "#E0F4E6", color: "#2D8C4E" },
  { id: "voicemail",    label: "Boîte vocale",  note: "Boîte vocale.",            bg: "#F5EDD6", color: "#8D742D" },
  { id: "no_answer",    label: "Pas de réponse", note: "Pas de réponse.",         bg: "#ECECEC", color: "#6B6B6B" },
  { id: "refused",      label: "Refus",         note: "Propriétaire a refusé.",  bg: "#FCE9E6", color: "#C0392B" },
  { id: "wrong_number", label: "Mauvais #",     note: "Mauvais numéro.",          bg: "#FCE9E6", color: "#C0392B" },
];

function sourceFor(owner, phone) {
  const k = normalizePhoneKey(phone);
  if (!k) return "Migrated";
  return owner?.phoneSources?.[k] || "Migrated";
}

function matches(haystack, needle) {
  if (!needle) return true;
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return norm(haystack).includes(norm(needle));
}

function formatCityLine(owner) {
  if (!owner) return "";
  const p = owner.postalAddress || {};
  const city = (p.city || "").trim();
  const prov = (p.province || "").trim();
  const pc   = (p.postalCode || "").trim();
  const bits = [];
  if (city && prov) bits.push(`${city} (${prov})`);
  else if (city) bits.push(city);
  else if (prov) bits.push(prov);
  if (pc) bits.push(pc);
  return bits.join(" · ");
}

function formatStreetLine(owner) {
  if (!owner) return "";
  const p = owner.postalAddress || {};
  return (p.street || "").trim();
}

function formatPostalAddressFallback(owner) {
  if (!owner) return "";
  const p = owner.postalAddress || {};
  const parts = [p.street, p.city, p.province, p.postalCode].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return describeOwnerKey(owner.ownerKey);
}

function makeDefaultT() {
  return (key, ...args) => {
    const fallback = {
      leads_label_proprio: "Propriétaire",
      leads_loading: "Chargement…",
      leads_ia_btn: "✦ IA",
      leads_ia_btn_busy: "…",
      leads_ia_clear: "Effacer",
      fin_section: "Finances",
      fin_noi: "NOI",
      fin_total_units: "Total unités",
      fin_revenue: "Revenu brut annuel ($)",
      fin_expenses: "Dépenses annuelles ($)",
      fin_unit_1_5: "1½", fin_unit_2_5: "2½", fin_unit_3_5: "3½",
      fin_unit_4_5: "4½", fin_unit_5_5: "5½+",
    };
    const v = fallback[key];
    if (typeof v === "function") return v(...args);
    return v != null ? v : key;
  };
}

const MENU_ITEM = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  padding: "13px 16px",
  border: "none",
  background: "none",
  fontSize: 14,
  cursor: "pointer",
  color: "var(--text)",
  borderBottom: "1px solid var(--border)",
};

export default function OwnersManager({ owners = [], setOwners, onAddLeads, t, lang = "fr" }) {
  const tr = typeof t === "function" ? t : makeDefaultT();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(owners[0]?.id || null);
  const [stageFilter, setStageFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortBy, setSortBy] = useState("buildings");
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichNotice, setEnrichNotice] = useState("");
  const [enrichProgress, setEnrichProgress] = useState(null);
  const [dailySpend, setDailySpend] = useState(() => loadTodaySpend());
  const isMobile = window.innerWidth <= 768;
  const [mobileView, setMobileView] = useState("list");
  const [aiBusy, setAiBusy] = useState(false);
  const [rolePreview, setRolePreview] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [rfMinValue, setRfMinValue] = useState("");
  const [rfMaxYear, setRfMaxYear] = useState("");
  const [rfInscriptionBefore, setRfInscriptionBefore] = useState("");
  const [rfUnitsMin, setRfUnitsMin] = useState("");
  const [rfUnitsMax, setRfUnitsMax] = useState("");

  // ⋯ overflow menu
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const menuBtnRef = useRef(null);
  const [menuTop, setMenuTop] = useState(48);

  // Secondary filters toggle
  const [showSecondaryFilters, setShowSecondaryFilters] = useState(false);

  const searchRef = useRef(null);
  useFocusHotkey(searchRef);
  useEscapeKey(() => setRolePreview(null), Boolean(rolePreview) && !roleBusy);
  useEscapeKey(() => setShowOverflowMenu(false), showOverflowMenu);

  const debouncedSearch = useDebouncedValue(search, 150);

  function openOverflowMenu() {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      setMenuTop(rect.bottom + 4);
    }
    setShowOverflowMenu(v => !v);
  }

  const filteredOwners = useMemo(() => {
    let list = Array.isArray(owners) ? [...owners] : [];
    if (stageFilter !== "all") {
      list = list.filter(o => (o.stage || "new") === stageFilter);
    }
    if (sourceFilter !== "all") {
      list = list.filter(o => {
        const phones = o.phones || [];
        if (sourceFilter === "missing") return phones.length === 0;
        return phones.some(p => sourceFor(o, p) === sourceFilter);
      });
    }
    if (debouncedSearch) {
      list = list.filter(o => {
        if (matches(o.displayName, debouncedSearch)) return true;
        if ((o.aliases || []).some(a => matches(a, debouncedSearch))) return true;
        if ((o.contactNames || []).some(n => matches(n, debouncedSearch))) return true;
        if ((o.phones || []).some(p => matches(p, debouncedSearch))) return true;
        if (matches(formatPostalAddressFallback(o), debouncedSearch)) return true;
        if ((o.buildings || []).some(b => matches(b.buildingAddress, debouncedSearch))) return true;
        return false;
      });
    }
    list.sort((a, b) => {
      if (sortBy === "name") return (a.displayName || "").localeCompare(b.displayName || "");
      if (sortBy === "phones") return (b.phones?.length || 0) - (a.phones?.length || 0);
      return (b.buildings?.length || 0) - (a.buildings?.length || 0);
    });
    return list;
  }, [owners, debouncedSearch, stageFilter, sourceFilter, sortBy]);

  const selected = useMemo(
    () => (owners || []).find(o => o.id === selectedId) || filteredOwners[0] || null,
    [owners, selectedId, filteredOwners],
  );

  const updateOwner = useCallback((id, patch) => {
    if (typeof setOwners !== "function") return;
    setOwners(prev => prev.map(o => o.id === id ? { ...o, ...patch, updatedAt: Date.now() } : o));
  }, [setOwners]);

  const updateBuildingFinances = useCallback((ownerId, buildingId, patch) => {
    if (typeof setOwners !== "function") return;
    setOwners(prev => prev.map(o => {
      if (o.id !== ownerId) return o;
      const nextBuildings = (o.buildings || []).map(b => {
        if (b.id !== buildingId) return b;
        const prevFin = ensureBuildingFinances(b).finances;
        return {
          ...b,
          finances: {
            ...prevFin,
            ...patch,
            unitMix: { ...prevFin.unitMix, ...(patch.unitMix || {}) },
          },
        };
      });
      return { ...o, buildings: nextBuildings, updatedAt: Date.now() };
    }));
  }, [setOwners]);

  const totals = useMemo(() => {
    const owns = Array.isArray(owners) ? owners : [];
    const buildings = owns.reduce((n, o) => n + (o.buildings?.length || 0), 0);
    const phones = owns.reduce((n, o) => n + (o.phones?.length || 0), 0);
    const missing = owns.filter(o => !o.phones || o.phones.length === 0).length;
    return { owners: owns.length, buildings, phones, missing };
  }, [owners]);

  // ── Rôle import ──

  function pickRoleFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
    inp.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setRoleError("");
      setRoleBusy(true);
      try {
        const parsed = await parseRoleXlsx(f);
        setRolePreview({ parsed, fileName: f.name });
      } catch (err) {
        setRoleError(String(err?.message || err));
        setRolePreview(null);
      } finally {
        setRoleBusy(false);
      }
    };
    inp.click();
  }

  function buildFilterFn() {
    const minValue = Number(rfMinValue) || 0;
    const maxYear = Number(rfMaxYear) || 0;
    const inscriptionYearMax = Number(rfInscriptionBefore) || 0;
    const unitsMin = Number(rfUnitsMin) || 0;
    const unitsMax = Number(rfUnitsMax) || 0;
    if (!minValue && !maxYear && !inscriptionYearMax && !unitsMin && !unitsMax) {
      return undefined;
    }
    return (p) => {
      if (minValue && (p.valeurImmeuble || 0) < minValue) return false;
      if (maxYear && (p.yearBuilt || 0) > maxYear) return false;
      if (inscriptionYearMax && p.dateInscription) {
        const m = String(p.dateInscription).match(/(19|20)\d{2}/);
        const y = m ? Number(m[0]) : 0;
        if (y && y > inscriptionYearMax) return false;
      }
      const units = p.nbTotalUnites || p.nbLogements || 0;
      if (unitsMin && units < unitsMin) return false;
      if (unitsMax && units > unitsMax) return false;
      return true;
    };
  }

  async function confirmRoleImport(mode) {
    if (!rolePreview?.parsed) return;
    const filterFn = buildFilterFn();
    const { parsed, fileName } = rolePreview;
    const { newOwners, updatedOwners, allOwners, leads } = buildOwnersAndLeadsFromRole(
      parsed,
      owners,
      { sourceFile: fileName, filterFn },
    );
    if (typeof setOwners === "function") setOwners(allOwners);
    if (typeof onAddLeads === "function" && leads.length) onAddLeads(leads);
    setEnrichNotice(tr("import_done", newOwners.length, updatedOwners.length, leads.length));
    setTimeout(() => setEnrichNotice(""), 6000);
    setRolePreview(null);
    resetRoleFilters();

    if (mode !== "import_only") {
      const targets = allOwners.filter(o =>
        (newOwners.some(n => n.id === o.id) || updatedOwners.some(u => u.id === o.id))
        && (!o.phones || o.phones.length === 0)
      );
      const cap = mode === "import_enrich_100" ? TEST_BATCH_SIZE : targets.length;
      if (targets.length) {
        await runEnrichment(targets.slice(0, cap), allOwners);
      }
    }
  }

  function resetRoleFilters() {
    setRfMinValue("");
    setRfMaxYear("");
    setRfInscriptionBefore("");
    setRfUnitsMin("");
    setRfUnitsMax("");
  }

  // ── Places enrichment ──

  async function runEnrichment(targets, seedOwners) {
    if (typeof setOwners !== "function") return;
    if (!Array.isArray(targets) || !targets.length) {
      setEnrichNotice(tr("enrich_none_targeted"));
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    const rowLookup = ownersToLookupRows(targets);
    if (!rowLookup.length) {
      setEnrichNotice(tr("enrich_none_usable"));
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    const currentSpend = loadTodaySpend();
    if (currentSpend.estCost >= DAILY_SPEND_CAP_USD) {
      setEnrichNotice(tr("enrich_cap_hit", formatCost(currentSpend.estCost)));
      setTimeout(() => setEnrichNotice(""), 6000);
      return;
    }

    setEnrichBusy(true);
    setEnrichProgress({ done: 0, total: rowLookup.length, newlyFound: 0 });

    let workingOwners = Array.isArray(seedOwners) ? seedOwners : owners;
    let done = 0;
    let totalFound = 0;
    let bail = false;

    for (let i = 0; i < rowLookup.length && !bail; i += BATCH_SIZE) {
      const slice = rowLookup.slice(i, i + BATCH_SIZE);
      try {
        const resp = await fetch("/api/phone-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: slice.map(s => s.row) }),
        });
        const data = await resp.json();
        if (!data?.ok) {
          if (resp.status === 402) {
            setEnrichNotice(data.error || tr("enrich_budget_hit"));
          } else {
            setEnrichNotice(data?.error || `Erreur serveur (${resp.status}).`);
          }
          bail = true;
          break;
        }
        if (data.budget && typeof data.budget.spentUsd === "number") {
          setDailySpend(prev => ({ ...prev, estCost: data.budget.spentUsd, date: data.budget.date || prev.date }));
        }
        const applied = applyLookupResultsToOwners(workingOwners, data.results || [], slice);
        workingOwners = applied.owners;
        totalFound += applied.touched;
        done += slice.length;
        setEnrichProgress({ done, total: rowLookup.length, newlyFound: totalFound });
        setOwners(workingOwners);
      } catch (err) {
        setEnrichNotice(`Erreur réseau: ${err?.message || err}`);
        bail = true;
        break;
      }
    }

    if (done > 0) {
      const est = estimateLookupCost(done);
      setDailySpend(recordBatch(done, est.mid));
    }
    setEnrichBusy(false);
    setEnrichProgress(null);
    if (!bail) {
      setEnrichNotice(
        totalFound > 0
          ? tr("enrich_ok", totalFound, totalFound > 1 ? "s" : "", done)
          : tr("enrich_nothing_found", done, done > 1 ? "s" : "")
      );
      setTimeout(() => setEnrichNotice(""), 6000);
    }
  }

  async function enrichAll() {
    const targets = (owners || []).filter(o =>
      (!o.phones || o.phones.length === 0) && (o.postalAddress?.street || o.postalAddress?.postalCode)
    );
    await runEnrichment(targets, owners);
  }

  async function enrichTest100() {
    const targets = (owners || []).filter(o =>
      (!o.phones || o.phones.length === 0) && (o.postalAddress?.street || o.postalAddress?.postalCode)
    );
    await runEnrichment(targets.slice(0, TEST_BATCH_SIZE), owners);
  }

  // ── AI note organizer ──

  async function runAI() {
    if (!selected) return;
    const text = (selected.callNotes || "").trim();
    if (!text) {
      setEnrichNotice(tr("leads_ia_err_empty"));
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "lead", text }),
      });
      const data = await res.json();
      const summary = data?.ok ? data.summary : (data?.error || tr("leads_ia_err_server"));
      updateOwner(selected.id, { aiLead: summary });
    } catch {
      updateOwner(selected.id, { aiLead: tr("leads_ia_err_server") });
    } finally {
      setAiBusy(false);
    }
  }

  function clearAI() {
    if (!selected) return;
    updateOwner(selected.id, { aiLead: "" });
  }

  function markOwnerCallNow(owner) {
    if (!owner?.id) return;
    const now = new Date();
    const stamp = now.toISOString();
    const line = `[${now.toLocaleString("fr-CA", { dateStyle:"short", timeStyle:"short" })}] Appel effectué.`;
    const existing = String(owner.callNotes || "").trim();
    updateOwner(owner.id, {
      lastCallAt: stamp,
      callNotes: existing ? `${existing}\n${line}` : line,
    });
  }

  // Outcome buttons that record what happened on the call. Each click
  // stamps the lastCallAt, sets owner.callStatus, and appends a dated
  // note to owner.callNotes so the timeline stays readable. callStatus
  // values match the LeadsManager CALL_STATUS_CFG vocabulary so a lead
  // exported into the deal pipeline keeps its label.
  function markOwnerCallOutcome(owner, outcomeId) {
    if (!owner?.id) return;
    const outcome = CALL_OUTCOMES.find((o) => o.id === outcomeId);
    if (!outcome) return;
    const now = new Date();
    const stamp = now.toISOString();
    const stampLabel = now.toLocaleString("fr-CA", { dateStyle:"short", timeStyle:"short" });
    const line = `[${stampLabel}] ${outcome.note}`;
    const existing = String(owner.callNotes || "").trim();
    updateOwner(owner.id, {
      callStatus: outcome.id,
      lastCallAt: stamp,
      callNotes: existing ? `${existing}\n${line}` : line,
    });
  }

  // ── Rendering ──

  const activeSecondaryCount = (sourceFilter !== "all" ? 1 : 0) + (sortBy !== "buildings" ? 1 : 0);

  return (
    <div className="om-shell">
      <style>{CSS}</style>

      {/* ⋯ overflow menu */}
      {showOverflowMenu && (
        <>
          <div style={{position:"fixed",inset:0,zIndex:200}} onClick={() => setShowOverflowMenu(false)} />
          <div style={{position:"fixed",right:12,top:menuTop,zIndex:201,background:"#fff",border:"1px solid var(--border)",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,.14)",minWidth:240,overflow:"hidden"}}>
            <button
              style={MENU_ITEM}
              onClick={() => { pickRoleFile(); setShowOverflowMenu(false); }}
              disabled={roleBusy}
            >
              {roleBusy ? tr("leads_btn_import_busy") : tr("leads_btn_import")}
            </button>
            <button
              style={{...MENU_ITEM, opacity: (enrichBusy || totals.missing === 0) ? 0.4 : 1}}
              onClick={() => { enrichAll(); setShowOverflowMenu(false); }}
              disabled={enrichBusy || totals.missing === 0}
            >
              {enrichBusy ? tr("leads_btn_enrich_busy") : tr("leads_btn_enrich")}
            </button>
            <button
              style={{...MENU_ITEM, borderBottom:"none", opacity: (enrichBusy || totals.missing === 0) ? 0.4 : 1}}
              onClick={() => { enrichTest100(); setShowOverflowMenu(false); }}
              disabled={enrichBusy || totals.missing === 0}
            >
              {tr("leads_btn_test100")}
            </button>
          </div>
        </>
      )}

      {/* Rôle preview modal */}
      {rolePreview && (() => {
        const stats = rolePreview.parsed.stats;
        const needLookup = stats.needLookup;
        const est = estimateLookupCost(needLookup);
        const firstFive = [];
        for (const drafts of rolePreview.parsed.ownersMap.values()) {
          if (firstFive.length >= 5) break;
          const d = drafts[0];
          firstFive.push({
            name: (d.firstName && d.lastName) ? `${d.firstName} ${d.lastName}` : d.name,
            address: [d.postalAddress.street, d.postalAddress.city, d.postalAddress.postalCode].filter(Boolean).join(", "),
            phones: drafts.flatMap(x => x.phones).slice(0, 2),
          });
        }
        const locale = lang === "en" ? "en-CA" : "fr-CA";
        return (
          <div className="mo" onClick={() => !roleBusy && setRolePreview(null)}>
            <div className="mo-box" onClick={e => e.stopPropagation()} style={{maxWidth:640}}>
              <div className="mo-title">{tr("import_title")}</div>
              <div className="mo-sub">
                <strong>{rolePreview.fileName}</strong>
              </div>
              <div className="mo-stats">
                <div><strong>{stats.properties.toLocaleString(locale)}</strong> {tr("om_import_stats_properties")}</div>
                <div><strong>{stats.uniquePostal.toLocaleString(locale)}</strong> {tr("om_import_stats_unique")}</div>
                <div>{stats.withPhone.toLocaleString(locale)} {tr("om_import_stats_with_phone")}</div>
                <div style={{color:"#8D742D",fontWeight:700}}>
                  {needLookup.toLocaleString(locale)} {tr("om_import_stats_to_lookup")}
                </div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>
                  {tr("om_import_est_cost")}{" "}
                  <strong>{formatCost(est.mid)}</strong> ({formatCost(est.lo)}–{formatCost(est.hi)})
                </div>
              </div>

              <div className="mo-sec-title">{tr("import_preview_title")}</div>
              <ul className="mo-list">
                {firstFive.map((o, i) => (
                  <li key={i}>
                    <strong>{o.name}</strong>
                    <div style={{fontSize:11,color:"var(--text3)"}}>{o.address || tr("om_missing_mailing")}</div>
                    {o.phones.length > 0 && <div style={{fontSize:11,color:"var(--gold)"}}><PhoneIcon size={10} style={{marginRight:3}} />{o.phones.join(" · ")}</div>}
                  </li>
                ))}
              </ul>

              <div className="mo-sec-title">{tr("import_filters_title")}</div>
              <div className="mo-filters">
                <label>
                  <span>{tr("om_filter_min_value")}</span>
                  <input type="number" placeholder="$" value={rfMinValue} onChange={e => setRfMinValue(e.target.value)} />
                </label>
                <label>
                  <span>{tr("om_filter_max_year")}</span>
                  <input type="number" placeholder="1970" value={rfMaxYear} onChange={e => setRfMaxYear(e.target.value)} />
                </label>
                <label>
                  <span>{tr("om_filter_inscription")}</span>
                  <input type="number" placeholder="2005" value={rfInscriptionBefore} onChange={e => setRfInscriptionBefore(e.target.value)} />
                </label>
                <label>
                  <span>{tr("om_filter_units_between")}</span>
                  <span style={{display:"flex",gap:6}}>
                    <input type="number" placeholder="min" value={rfUnitsMin} onChange={e => setRfUnitsMin(e.target.value)} style={{width:"50%"}} />
                    <input type="number" placeholder="max" value={rfUnitsMax} onChange={e => setRfUnitsMax(e.target.value)} style={{width:"50%"}} />
                  </span>
                </label>
              </div>

              <div className="mo-foot">
                <button className="btn" onClick={() => setRolePreview(null)} disabled={roleBusy}>{tr("import_cancel")}</button>
                <button className="btn" onClick={() => confirmRoleImport("import_only")} disabled={roleBusy}>{tr("import_only")}</button>
                <button className="btn" onClick={() => confirmRoleImport("import_enrich_100")} disabled={roleBusy}>{tr("import_enrich_100")}</button>
                <button className="btn btn-gold" onClick={() => confirmRoleImport("import_enrich_all")} disabled={roleBusy}>{tr("import_enrich_all")}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Top bar ── */}
      <div className="om-topbar">
        <div>
          <div className="om-title">{tr("leads_header_title")} · {totals.owners}</div>
          <div className="om-sub">
            {tr("leads_header_counts", totals.buildings, totals.buildings !== 1 ? "s" : "", totals.phones, totals.phones !== 1 ? "s" : "")}
            {totals.missing > 0 ? tr("leads_header_missing", totals.missing) : ""}
          </div>
        </div>
        <button
          ref={menuBtnRef}
          onClick={openOverflowMenu}
          className="om-menu-btn"
          aria-label="Plus d'actions"
          disabled={roleBusy}
        >
          ⋯
        </button>
      </div>

      {/* ── Search + Stage filter bar ── */}
      <div className="om-toolbar">
        <input
          ref={searchRef}
          className="om-search"
          placeholder={tr("leads_search_placeholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="om-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="all">{tr("leads_filter_all_stages")}</option>
          {STAGES.map(s => <option key={s.id} value={s.id}>{tr(s.tkey)}</option>)}
        </select>
        <button
          className="om-filters-toggle"
          style={{background:showSecondaryFilters||activeSecondaryCount?"var(--gold-light)":undefined,borderColor:showSecondaryFilters||activeSecondaryCount?"#E9D9AA":undefined}}
          onClick={() => setShowSecondaryFilters(v => !v)}
        >
          {showSecondaryFilters ? "▾" : "▸"} Filtres{activeSecondaryCount > 0 ? ` (${activeSecondaryCount})` : ""}
        </button>
      </div>

      {/* ── Secondary filters (collapsible) ── */}
      {showSecondaryFilters && (
        <div className="om-toolbar om-toolbar-secondary">
          <select className="om-select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            <option value="all">{tr("leads_filter_all_sources")}</option>
            <option value="missing">{tr("leads_filter_missing_phone")}</option>
            <option value="Excel">{tr("src_excel")}</option>
            <option value="Places">{tr("src_places")}</option>
            <option value="Manual">{tr("src_manual")}</option>
          </select>
          <select className="om-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="buildings">{tr("leads_sort_buildings")}</option>
            <option value="phones">{tr("leads_sort_phones")}</option>
            <option value="name">{tr("leads_sort_name")}</option>
          </select>
        </div>
      )}

      {enrichNotice && <div className="om-notice">{enrichNotice}</div>}
      {roleError && <div className="om-notice om-notice-err"><WarningIcon size={12} style={{marginRight:4}} />{roleError}</div>}
      {enrichProgress && (
        <div className="om-progress">
          <div className="om-progress-row">
            <span><HourglassIcon size={12} style={{marginRight:4}} />{enrichProgress.done} / {enrichProgress.total} · {enrichProgress.newlyFound}</span>
            <span className="om-progress-spend">~{formatCost(dailySpend.estCost)}</span>
          </div>
          <div className="om-progress-bar">
            <div style={{ width: `${Math.round((enrichProgress.done / Math.max(1, enrichProgress.total)) * 100)}%` }} />
          </div>
        </div>
      )}

      {totals.owners === 0 ? (
        <div className="om-empty">
          <div style={{fontSize:15, fontWeight:600, marginBottom:6}}>{tr("leads_empty_title")}</div>
          <div>{tr("leads_empty_body")}</div>
        </div>
      ) : (
        <div className="om-grid">
          {/* Owner list */}
          {(!isMobile || mobileView === "list") && (
            <section className="om-list" style={{touchAction:"pan-y",overscrollBehavior:"none"}}>
              {filteredOwners.length === 0 ? (
                <div className="om-empty-small">{tr("leads_empty_search", debouncedSearch)}</div>
              ) : filteredOwners.map(o => {
                const s = stageCfg(o.stage || "new");
                const active = selected && selected.id === o.id;
                return (
                  <button
                    key={o.id}
                    className={`om-row${active ? " active" : ""}`}
                    onClick={() => { setSelectedId(o.id); if (isMobile) setMobileView("fiche"); }}
                  >
                    <div className="om-row-main">
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6 }}>
                        <div className="om-row-name">{o.displayName || "(Propriétaire inconnu)"}</div>
                        <span className="om-pill" style={{ background:s.bg, color:s.color, flexShrink:0, fontSize:12 }}>{tr(s.tkey)}</span>
                      </div>
                      <div className="om-row-sub">
                        {formatPostalAddressFallback(o) || describeOwnerKey(o.ownerKey)}
                        {(o.buildings?.length || 0) > 0 && <span style={{ marginLeft:6, opacity:.7 }}>· {o.buildings.length} imm.</span>}
                      </div>
                    </div>
                    <div className="om-row-phone">
                      {(o.phones?.length || 0) > 0
                        ? <span style={{ fontSize:12, fontWeight:600, color:"#2E7D32" }}><PhoneIcon size={10} style={{marginRight:2}} />{o.phones[0]}</span>
                        : <span style={{ fontSize:11, color:"#cc0000" }}>sans tél.</span>}
                    </div>
                  </button>
                );
              })}
            </section>
          )}

          {/* Owner fiche — full-screen overlay on mobile */}
          {(!isMobile || mobileView === "fiche") && (
            <section
              className={isMobile ? "" : "om-fiche"}
              style={isMobile ? {
                position:"fixed",
                inset:0,
                background:"#fff",
                zIndex:100,
                display:"flex",
                flexDirection:"column",
                // Push the fixed sheet below the iPhone Dynamic Island /
                // status bar so the back button isn't covered by the OS
                // overlay (status pill, in-call indicator, etc.).
                paddingTop:"env(safe-area-inset-top)",
                paddingBottom:"env(safe-area-inset-bottom)",
              } : {}}
            >
              {isMobile && (
                <div style={{display:"flex",alignItems:"center",height:44,borderBottom:"1px solid var(--border)",padding:"0 12px",flexShrink:0,background:"#fff"}}>
                  <button className="back-btn" style={{margin:0,marginRight:"auto"}} onClick={() => setMobileView("list")}>
                    ← Retour
                  </button>
                  {selected && (
                    <div style={{fontWeight:600,fontSize:15,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,padding:"0 8px"}}>
                      {selected.displayName || "(Propriétaire inconnu)"}
                    </div>
                  )}
                  <div style={{width:70}} />
                </div>
              )}
              <div style={isMobile ? {overflowY:"auto",flex:1} : {}}>
                {selected ? (
                  <OwnerFiche
                    owner={selected}
                    onUpdate={patch => updateOwner(selected.id, patch)}
                    onUpdateBuildingFinances={(bid, patch) => updateBuildingFinances(selected.id, bid, patch)}
                    onRunAI={runAI}
                    onClearAI={clearAI}
                    onMarkCall={markOwnerCallNow}
                    onMarkCallOutcome={markOwnerCallOutcome}
                    aiBusy={aiBusy}
                    tr={tr}
                  />
                ) : (
                  <div className="om-empty-small">{tr("leads_select_hint")}</div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* FAB — open role import */}
      {(!isMobile || mobileView === "list") && (
        <button
          onClick={pickRoleFile}
          aria-label={tr("leads_btn_import")}
          disabled={roleBusy}
          style={{
            position:"fixed",
            bottom:"calc(16px + env(safe-area-inset-bottom))",
            right:16,
            zIndex:90,
            width:56,
            height:56,
            borderRadius:"50%",
            background:"var(--gold,#C9A84C)",
            color:"#fff",
            border:"none",
            fontSize:28,
            cursor:roleBusy ? "not-allowed" : "pointer",
            opacity:roleBusy ? 0.6 : 1,
            boxShadow:"0 4px 16px rgba(0,0,0,.22)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            lineHeight:1,
          }}
        >
          +
        </button>
      )}
    </div>
  );
}

// Per-building Finances block.
function BuildingFinances({ building, onChange, tr }) {
  const withFin = ensureBuildingFinances(building);
  const fin = withFin.finances;
  const noi = computeBuildingNOI(withFin);
  const totalUnits = computeBuildingTotalUnits(withFin);

  const setField = (key, value) => {
    const num = value === "" ? null : Number(value);
    onChange({ [key]: Number.isFinite(num) ? num : null });
  };
  const setMix = (key, value) => {
    const num = Number(value) || 0;
    onChange({ unitMix: { [key]: num } });
  };

  return (
    <div className="bld-fin open">
      <div className="bld-fin-header">
        <span className="bld-fin-title">{tr("fin_section")}</span>
        <span className="bld-fin-readouts">
          {tr("fin_noi")}: <strong>{noi == null ? "—" : `$${noi.toLocaleString("en-CA")}`}</strong>
          <span style={{margin:"0 8px",color:"var(--text3)"}}>·</span>
          {tr("fin_total_units")}: <strong>{totalUnits || "—"}</strong>
        </span>
      </div>
      <div className="bld-fin-body">
        <div className="bld-fin-row">
          <label className="bld-fin-field">
            <span>{tr("fin_revenue")}</span>
            <input
              type="number"
              value={fin.revenueAnnuel == null ? "" : fin.revenueAnnuel}
              placeholder="0"
              onChange={e => setField("revenueAnnuel", e.target.value)}
            />
          </label>
          <label className="bld-fin-field">
            <span>{tr("fin_expenses")}</span>
            <input
              type="number"
              value={fin.depensesAnnuelles == null ? "" : fin.depensesAnnuelles}
              placeholder="0"
              onChange={e => setField("depensesAnnuelles", e.target.value)}
            />
          </label>
        </div>
        <div className="bld-fin-mix">
          <div className="bld-fin-mix-lbl">{tr("fin_unit_mix")}</div>
          <div className="bld-fin-mix-grid">
            {[
              ["u1_5", tr("fin_unit_1_5")],
              ["u2_5", tr("fin_unit_2_5")],
              ["u3_5", tr("fin_unit_3_5")],
              ["u4_5", tr("fin_unit_4_5")],
              ["u5_5_plus", tr("fin_unit_5_5")],
            ].map(([k, lbl]) => (
              <label key={k} className="bld-fin-cell">
                <span>{lbl}</span>
                <input
                  type="number"
                  min="0"
                  value={fin.unitMix[k] || ""}
                  placeholder="0"
                  onChange={e => setMix(k, e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnerFiche({ owner, onUpdate, onUpdateBuildingFinances, onRunAI, onClearAI, onMarkCall, onMarkCallOutcome, aiBusy, tr }) {
  const s = stageCfg(owner.stage || "new");
  const contactNames = Array.isArray(owner.contactNames) ? owner.contactNames : [];
  const primary = owner.displayName || "(Propriétaire inconnu)";
  const alsoNames = contactNames.filter(n => n && n !== primary);
  const street = formatStreetLine(owner);
  const cityLine = formatCityLine(owner);

  return (
    <div className="fiche-body">
      <header className="fiche-head">
        <div style={{minWidth:0,flex:1}}>
          <div className="fiche-eyebrow">{tr("leads_label_proprio")}</div>
          <div className="fiche-name">{primary}</div>
          {alsoNames.length > 0 && (
            <div className="fiche-also">{tr("leads_count_also", alsoNames.join(" · "))}</div>
          )}
          <div className="fiche-addr-stack">
            {street && <div className="fiche-addr"><MapPinIcon size={11} style={{marginRight:4}} />{street}</div>}
            {cityLine && <div className="fiche-addr-sub">{cityLine}</div>}
            {!street && !cityLine && (
              <div className="fiche-addr"><MapPinIcon size={11} style={{marginRight:4}} />{describeOwnerKey(owner.ownerKey)}</div>
            )}
          </div>
          {owner.matchedBusinessName ? (
            <div className="fiche-matched">
              {tr("leads_places_matched")} <strong>{owner.matchedBusinessName}</strong>
            </div>
          ) : null}
        </div>
        <div className="fiche-stage-wrap">
          <span className="om-pill" style={{ background: s.bg, color: s.color }}>{tr(s.tkey)}</span>
          <select
            className="om-select fiche-stage"
            value={owner.stage || "new"}
            onChange={e => onUpdate({ stage: e.target.value })}
          >
            {STAGES.map(st => <option key={st.id} value={st.id}>{tr(st.tkey)}</option>)}
          </select>
        </div>
      </header>

      {(owner.phones?.length > 0) && (
        <div className="fiche-phones">
          {owner.phones.map((p, i) => {
            const src = sourceFor(owner, p);
            const cfg = SOURCE_CFG[src] || SOURCE_CFG.Migrated;
            return (
              <span key={i} className="fiche-phone-chip">
                <a href={`tel:${String(p).replace(/\D+/g, "")}`} onClick={() => onMarkCall?.(owner)}>{p}</a>
                <span className="om-src-badge" style={{background: cfg.bg, color: cfg.color}} title={tr(cfg.tkey)}>{tr(cfg.tkey)}</span>
              </span>
            );
          })}
          <button className="btn btn-sm btn-gold" style={{marginLeft:4}} onClick={() => onMarkCall?.(owner)}>
            <PhoneIcon size={12} style={{marginRight:4}} />Marquer appel maintenant
          </button>
          {owner.lastCallAt && <span style={{fontSize:11,color:"var(--text2)",marginLeft:6}}>Dernier: {new Date(owner.lastCallAt).toLocaleString("fr-CA",{dateStyle:"short",timeStyle:"short"})}</span>}
          {/* Outcome row — wraps under the action button on narrow screens. */}
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8,width:"100%"}}>
            <span style={{fontSize:11,fontWeight:600,color:"var(--text2)",alignSelf:"center",marginRight:2}}>Résultat:</span>
            {CALL_OUTCOMES.map((o) => {
              const active = owner.callStatus === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onMarkCallOutcome?.(owner, o.id)}
                  style={{
                    fontSize:12,
                    fontWeight:600,
                    padding:"5px 10px",
                    borderRadius:999,
                    border:active ? `1.5px solid ${o.color}` : "1px solid var(--border)",
                    background: active ? o.bg : "#fff",
                    color: active ? o.color : "var(--text2)",
                    cursor:"pointer",
                    minHeight:32,
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(owner.aliases?.length > 0 || owner.emails?.length > 0) && (
        <div className="fiche-inline">
          {owner.aliases?.length > 0 && (
            <div className="fiche-inline-grp">
              {owner.aliases.map((a, i) => (
                <span key={i} className="fiche-chip">{a}</span>
              ))}
            </div>
          )}
          {owner.emails?.length > 0 && (
            <div className="fiche-inline-grp">
              {owner.emails.map((e, i) => (
                <a key={i} className="fiche-email" href={`mailto:${e}`}>{e}</a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="fiche-buildings">
        <div className="fiche-section-lbl">
          {(owner.buildings?.length || 0)} × propriét{(owner.buildings?.length || 0) === 1 ? "é" : "és"}
        </div>
        {owner.buildings?.length ? (
          <div className="bld-stack">
            {owner.buildings.map((b, i) => (
              <div key={b.id || i} className="bld-card">
                <div className="bld-head-line">
                  <span className="bld-addr">{b.address || b.buildingAddress || "—"}</span>
                  <span className="bld-meta">
                    {b.city ? `${b.city}` : ""}
                    {b.units ? ` · ${b.units} u.` : ""}
                    {b.yearBuilt ? ` · ${b.yearBuilt}` : ""}
                    {b.assessment ? ` · ${b.assessment}` : ""}
                  </span>
                </div>
                <BuildingFinances
                  building={b}
                  onChange={(patch) => onUpdateBuildingFinances(b.id, patch)}
                  tr={tr}
                />
              </div>
            ))}
          </div>
        ) : <div className="fiche-empty">{tr("leads_no_buildings")}</div>}
      </div>

      <div className="fiche-notes">
        <div className="fiche-notes-head">
          <div className="fiche-section-lbl" style={{display:"flex",alignItems:"center",gap:6}}>
            {tr("leads_call_notes")}
            <VoiceDictation onTranscript={text => {
              const cur = owner.callNotes || "";
              onUpdate({ callNotes: cur + (cur && !cur.endsWith("\n") ? "\n" : "") + text });
            }} />
          </div>
          <button
            type="button"
            className={`ai-btn${aiBusy ? " loading" : ""}`}
            onClick={onRunAI}
            disabled={aiBusy || !((owner.callNotes || "").trim())}
            title={tr("leads_ia_placeholder")}
          >
            {aiBusy ? tr("leads_ia_btn_busy") : tr("leads_ia_btn")}
          </button>
        </div>
        <textarea
          className="fiche-textarea"
          placeholder={tr("leads_call_notes_placeholder")}
          value={owner.callNotes || ""}
          onChange={e => onUpdate({ callNotes: e.target.value })}
        />
        {owner.aiLead ? (
          <div className="ai-box">
            <div className="ai-box-lbl">{tr("leads_ia_label")}</div>
            <div style={{whiteSpace:"pre-wrap"}}>{owner.aiLead}</div>
            <button className="btn btn-sm" style={{marginTop:10}} onClick={onClearAI}>
              {tr("leads_ia_clear")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const CSS = `
.om-shell{display:flex;flex-direction:column;gap:0;min-height:0;flex:1}

/* Top bar */
.om-topbar{display:flex;align-items:center;justify-content:space-between;padding:0 14px;height:44px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--card,#fff)}
.om-title{font-size:17px;font-weight:700;color:var(--text)}
.om-sub{font-size:11px;color:var(--text3);margin-top:1px}
.om-menu-btn{background:none;border:1px solid var(--border);border-radius:8px;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text2);letter-spacing:3px;line-height:1;flex-shrink:0}
.om-menu-btn:disabled{opacity:.4;cursor:not-allowed}

/* Search + filter bar */
.om-toolbar{display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--card,#fff);flex-shrink:0}
.om-toolbar-secondary{background:#FAF8F4}
.om-search{flex:1;min-width:0;border:1px solid var(--border);background:#fff;border-radius:7px;padding:6px 10px;font-size:16px;height:44px;outline:none}
.om-search:focus{border-color:#D9C07A;box-shadow:0 0 0 2px #F5EDD6}
.om-select{flex:0 0 auto;border:1px solid var(--border);background:#fff;border-radius:7px;padding:5px 8px;font-size:14px;height:44px;outline:none;cursor:pointer;max-width:180px}
.om-filters-toggle{flex:0 0 auto;border:1px solid var(--border);background:#fff;border-radius:7px;padding:0 12px;font-size:13px;height:44px;cursor:pointer;white-space:nowrap;color:var(--text)}
.om-filters-toggle:hover{background:#FAF8F4}

.om-notice{background:#F5EDD6;border:1px solid #E9D9AA;border-radius:8px;padding:9px 12px;font-size:12px;color:#8D742D;font-weight:600;margin:8px 12px 0}
.om-notice-err{background:#FCE9E6;border-color:#F5C9C2;color:#A93425}

.om-progress{background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;margin:8px 12px 0}
.om-progress-row{display:flex;justify-content:space-between;font-size:12px;color:var(--text2);font-weight:600}
.om-progress-spend{color:var(--text3);font-weight:500}
.om-progress-bar{height:6px;background:#F0EDE3;border-radius:999px;overflow:hidden}
.om-progress-bar > div{height:100%;background:var(--gold);border-radius:999px;transition:width .2s}

.om-empty{background:var(--card);border:1px dashed var(--border);border-radius:12px;padding:40px;text-align:center;color:var(--text2);line-height:1.5;margin:12px}
.om-empty-small{padding:24px;text-align:center;color:var(--text3);font-size:13px}

/* Grid: list left, fiche right */
.om-grid{display:grid;grid-template-columns:minmax(320px, 370px) 1fr;gap:0;min-height:0;flex:1;overflow:hidden}

.om-list{overflow-y:auto;min-height:0;border-right:1px solid var(--border);background:var(--bg,#FAF6EF)}
.om-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border:none;background:transparent;padding:14px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;min-height:72px}
.om-row:last-child{border-bottom:none}
.om-row:hover{background:#FAF8F4}
.om-row.active{background:var(--gold-light)}
.om-row-main{min-width:0;flex:1}
.om-row-name{font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.om-row-sub{font-size:11px;color:var(--text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.om-row-phone{display:flex;align-items:center;flex-shrink:0;margin-left:4px}
.om-badge{font-size:10px;padding:2px 6px;border-radius:6px;background:#F0EDE3;color:var(--text2);font-weight:600}
.om-pill{font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700;letter-spacing:.2px}
.om-src-badge{font-size:10px;padding:2px 7px;border-radius:999px;font-weight:700;letter-spacing:.2px}

/* Fiche */
.om-fiche{overflow-y:auto;min-height:0;background:var(--card)}
.fiche-body{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.fiche-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.fiche-eyebrow{font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:4px}
.fiche-name{font-size:20px;font-weight:700;color:var(--text);line-height:1.2}
.fiche-also{font-size:11px;color:var(--text3);margin-top:2px;font-style:italic}
.fiche-addr-stack{margin-top:4px;display:flex;flex-direction:column;gap:2px}
.fiche-addr{font-size:13px;color:var(--text2)}
.fiche-addr-sub{font-size:12px;color:var(--text3)}
.fiche-matched{font-size:11px;color:var(--text3);margin-top:4px;font-style:italic}
.fiche-stage-wrap{display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0}
.fiche-stage{font-size:12px;padding:4px 8px}

.fiche-phones{display:flex;flex-wrap:wrap;gap:6px}
.fiche-phone-chip{display:inline-flex;align-items:center;gap:6px;background:#FAF8F4;border:1px solid var(--border);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--text)}
.fiche-phone-chip a{color:var(--blue);text-decoration:none;font-weight:600}

.fiche-inline{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.fiche-inline-grp{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}
.fiche-chip{display:inline-flex;align-items:center;background:#F0EDE3;color:var(--text2);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600}
.fiche-email{color:var(--blue);text-decoration:none;font-size:12px;font-weight:600}

.fiche-section-lbl{font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.3px;text-transform:uppercase;margin-bottom:6px}
.fiche-empty{font-size:12px;color:var(--text3);font-style:italic}
.fiche-buildings{display:flex;flex-direction:column}

.bld-stack{display:flex;flex-direction:column;gap:8px}
.bld-card{background:#FAF8F4;border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.bld-head-line{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
.bld-addr{font-size:13px;font-weight:700;color:var(--text)}
.bld-meta{font-size:11px;color:var(--text3)}

.bld-fin{background:#fff;border:1px solid #E9D9AA;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:14px}
.bld-fin-header{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.bld-fin-title{font-size:11px;font-weight:700;color:#8D742D;letter-spacing:.6px;text-transform:uppercase}
.bld-fin-readouts{font-size:12px;font-weight:500;color:var(--text2)}
.bld-fin-readouts strong{color:var(--text);font-weight:700}
.bld-fin-body{display:flex;flex-direction:column;gap:14px}
.bld-fin-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bld-fin-field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.2px;text-transform:uppercase}
.bld-fin-field input{border:1px solid var(--border);background:#fff;border-radius:8px;padding:10px 12px;font-size:15px;font-weight:600;outline:none}
.bld-fin-field input:focus{border-color:#D9C07A;box-shadow:0 0 0 3px #F5EDD6}
.bld-fin-mix-lbl{font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.2px;text-transform:uppercase;margin-bottom:6px}
.bld-fin-mix-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.bld-fin-cell{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--text2);text-align:center}
.bld-fin-cell input{border:1px solid var(--border);background:#fff;border-radius:8px;padding:8px 6px;font-size:14px;font-weight:600;text-align:center;outline:none;min-width:0;width:100%}
.bld-fin-cell input:focus{border-color:#D9C07A;box-shadow:0 0 0 2px #F5EDD6}

.fiche-notes{display:flex;flex-direction:column;gap:8px}
.fiche-notes-head{display:flex;justify-content:space-between;align-items:center}
.fiche-textarea{width:100%;min-height:110px;border:1px solid var(--border);background:#fff;border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;resize:vertical}
.fiche-textarea:focus{border-color:#D9C07A;box-shadow:0 0 0 3px #F5EDD6}

/* Modal */
.mo{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}
.mo-box{background:#fff;border-radius:14px;padding:20px 22px;max-width:520px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.18)}
.mo-title{font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px}
.mo-sub{font-size:12px;color:var(--text2);margin-bottom:12px}
.mo-stats{background:#FAF8F4;border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:12px;color:var(--text);display:flex;flex-direction:column;gap:4px;margin-bottom:14px}
.mo-sec-title{font-size:12px;font-weight:700;color:var(--text);margin:14px 0 8px;letter-spacing:.2px;text-transform:uppercase}
.mo-list{list-style:none;padding:0;margin:0 0 6px;display:flex;flex-direction:column;gap:6px;font-size:12px}
.mo-list li{border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:#fff}
.mo-filters{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.mo-filters label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text2);font-weight:600}
.mo-filters input{border:1px solid var(--border);background:#fff;border-radius:6px;padding:6px 8px;font-size:13px;outline:none;width:100%}
.mo-filters input:focus{border-color:#D9C07A;box-shadow:0 0 0 2px #F5EDD6}
.mo-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}

@media (max-width:768px){
  .om-grid{display:flex;flex-direction:column;flex:1;min-height:0}
  .om-list{flex:1;min-height:0;border-right:none;border-bottom:1px solid var(--border)}
  .om-row{min-height:72px;padding:14px 16px}
  .om-row-name{font-size:15px}
  .om-row-sub{font-size:12px;margin-top:4px}
  .om-pill{font-size:12px;padding:5px 10px;min-height:30px;display:inline-flex;align-items:center}
  .om-select{height:44px;font-size:16px;max-width:none;flex:1}
  .om-search{font-size:16px;height:44px}
  .om-filters-toggle{height:44px}
  .fiche-stage{width:100%;font-size:16px}
}
@media (max-width:720px){
  .bld-fin-row{grid-template-columns:1fr}
  .bld-fin-mix-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:1100px){
  .om-grid{grid-template-columns:1fr}
}
`;
