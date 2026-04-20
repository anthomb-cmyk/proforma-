// Owners view — the primary CRM entity is now the investor (1 postal address
// = 1 person), not the individual building. An Owner can have many companies
// (aliases), many phone numbers, many buildings, and one mailing address.
//
// This page is a minimal, functional investor-centric view:
//   • Left column: owner list with search + sort + source filter
//   • Right column: owner fiche showing aliases (companies), phones (with
//     source badges), emails, buildings, postal address, and call notes
//   • Header: "Importer un rôle" (XLSX) + "Enrichir numéros manquants"
//     with a "tester 100 d'abord" preset to validate hit rate before
//     committing to a full batch
//
// Owners come from App state (populated either via migration of existing
// leads, via the roleImport flow, or by the Leads importer — see
// lib/ownerGrouping.js + lib/roleImport.js). Call notes and stage persist
// per-owner, not per-building.

import { useMemo, useState, useRef } from "react";
import useFocusHotkey from "../lib/useFocusHotkey.js";
import useDebouncedValue from "../lib/useDebouncedValue.js";
import useEscapeKey from "../lib/useEscapeKey.js";
import { describeOwnerKey } from "../lib/ownerKey.js";
import { ownersToLookupRows, applyLookupResultsToOwners, mergeOwners } from "../lib/ownerGrouping.js";
import { normalizePhoneKey } from "../lib/phoneUtils.js";
import { parseRoleXlsx, buildOwnersAndLeadsFromRole } from "../lib/roleImport.js";
import { estimateLookupCost, formatCost } from "../lib/phoneLookupCost.js";
import { loadTodaySpend, recordBatch } from "../lib/dailySpendTracker.js";

// Batch size for the POST /api/phone-lookup call — matches PhoneFinder's
// BATCH_SIZE (keeps each request under the proxy/timeout ceiling).
const BATCH_SIZE = 10;

// Hard daily cap on phone-lookup spend. Mirrors the backend-side budget
// check so the client refuses to start a batch that would obviously blow
// past the cap — surfaces the 402 error from the server proactively.
const DAILY_SPEND_CAP_USD = 50;

// Preset for "Tester 100 d'abord" — lets the user measure Places hit rate
// before committing the full batch.
const TEST_BATCH_SIZE = 100;

const STAGES = [
  { id: "new",       label: "Nouveau",    color: "#6B6B6B", bg: "#ECECEC" },
  { id: "to_call",   label: "À appeler",  color: "#C9A84C", bg: "#F5EDD6" },
  { id: "contacted", label: "Contacté",   color: "#2563EB", bg: "#E0EAFF" },
  { id: "qualified", label: "Qualifié",   color: "#2D8C4E", bg: "#E0F4E6" },
  { id: "converted", label: "Converti",   color: "#2D8C4E", bg: "#D0ECD9" },
  { id: "lost",      label: "Perdu",      color: "#C0392B", bg: "#FCE9E6" },
];

function stageCfg(id) {
  return STAGES.find(s => s.id === id) || STAGES[0];
}

// Source badge colors + labels. Excel = Rôle d'évaluation import, Places =
// Google Places lookup, Manual = typed into the fiche, Migrated = pre-dates
// the phoneSources convention (absent source).
const SOURCE_CFG = {
  Excel:    { label: "Excel",    bg: "#ECECEC", color: "#6B6B6B" },
  Places:   { label: "Places",   bg: "#F5EDD6", color: "#8D742D" },
  Manual:   { label: "Manuel",   bg: "#E0EAFF", color: "#2563EB" },
  Migrated: { label: "Importé",  bg: "#F0EDE3", color: "#7B7B7B" },
};

function sourceFor(owner, phone) {
  const k = normalizePhoneKey(phone);
  if (!k) return "Migrated";
  return owner?.phoneSources?.[k] || "Migrated";
}

// Case-insensitive accent-less substring match — lets "tremblay" find
// "Trèmblay" regardless of accent typing.
function matches(haystack, needle) {
  if (!needle) return true;
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return norm(haystack).includes(norm(needle));
}

// One-line formatter for the owner's mailing address. Fallback to the key
// itself (human-legible) if the structured address is missing.
function formatPostalAddress(owner) {
  if (!owner) return "";
  const p = owner.postalAddress || {};
  const parts = [p.street, p.city, p.province, p.postalCode].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return describeOwnerKey(owner.ownerKey);
}

export default function OwnersManager({ owners = [], setOwners, onAddLeads }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(owners[0]?.id || null);
  const [stageFilter, setStageFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all"); // all | missing | Excel | Places | Manual
  const [sortBy, setSortBy] = useState("buildings"); // buildings | name | phones
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichNotice, setEnrichNotice] = useState("");
  const [enrichProgress, setEnrichProgress] = useState(null); // { done, total, newlyFound }
  const [dailySpend, setDailySpend] = useState(() => loadTodaySpend());

  // Rôle import modal state. rolePreview holds the parsed structure while
  // the user reviews stats + filters; null means no modal open.
  const [rolePreview, setRolePreview] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState("");
  // Targeting filters applied BEFORE we emit Leads. Defaults: all off.
  const [rfMinValue, setRfMinValue] = useState("");
  const [rfMaxYear, setRfMaxYear] = useState("");
  const [rfInscriptionBefore, setRfInscriptionBefore] = useState("");
  const [rfUnitsMin, setRfUnitsMin] = useState("");
  const [rfUnitsMax, setRfUnitsMax] = useState("");

  const searchRef = useRef(null);
  useFocusHotkey(searchRef);
  useEscapeKey(() => setRolePreview(null), Boolean(rolePreview) && !roleBusy);

  const debouncedSearch = useDebouncedValue(search, 150);

  const filteredOwners = useMemo(() => {
    let list = Array.isArray(owners) ? [...owners] : [];
    if (stageFilter !== "all") {
      list = list.filter(o => (o.stage || "new") === stageFilter);
    }
    if (sourceFilter !== "all") {
      list = list.filter(o => {
        const phones = o.phones || [];
        if (sourceFilter === "missing") return phones.length === 0;
        // Match if ANY phone on the owner has this source.
        return phones.some(p => sourceFor(o, p) === sourceFilter);
      });
    }
    if (debouncedSearch) {
      list = list.filter(o => {
        if (matches(o.displayName, debouncedSearch)) return true;
        if ((o.aliases || []).some(a => matches(a, debouncedSearch))) return true;
        if ((o.contactNames || []).some(n => matches(n, debouncedSearch))) return true;
        if ((o.phones || []).some(p => matches(p, debouncedSearch))) return true;
        if (matches(formatPostalAddress(o), debouncedSearch)) return true;
        if ((o.buildings || []).some(b => matches(b.buildingAddress, debouncedSearch))) return true;
        return false;
      });
    }
    list.sort((a, b) => {
      if (sortBy === "name") return (a.displayName || "").localeCompare(b.displayName || "");
      if (sortBy === "phones") return (b.phones?.length || 0) - (a.phones?.length || 0);
      // default: most buildings first — the biggest investors float up
      return (b.buildings?.length || 0) - (a.buildings?.length || 0);
    });
    return list;
  }, [owners, debouncedSearch, stageFilter, sourceFilter, sortBy]);

  const selected = useMemo(
    () => (owners || []).find(o => o.id === selectedId) || filteredOwners[0] || null,
    [owners, selectedId, filteredOwners],
  );

  function updateOwner(id, patch) {
    if (typeof setOwners !== "function") return;
    setOwners(prev => prev.map(o => o.id === id ? { ...o, ...patch, updatedAt: Date.now() } : o));
  }

  const totals = useMemo(() => {
    const owns = Array.isArray(owners) ? owners : [];
    const buildings = owns.reduce((n, o) => n + (o.buildings?.length || 0), 0);
    const phones = owns.reduce((n, o) => n + (o.phones?.length || 0), 0);
    const missing = owns.filter(o => !o.phones || o.phones.length === 0).length;
    return { owners: owns.length, buildings, phones, missing };
  }, [owners]);

  // ── Rôle import ──────────────────────────────────────────────────────────

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

  // Build the filter predicate from the modal's targeting inputs. Each
  // input is optional — blanks mean "no constraint on that axis".
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
        // dateInscription format varies — pull out the year with a regex.
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

  // Apply the staged import and optionally kick off enrichment. `mode`
  // is one of "import_only" | "import_enrich_all" | "import_enrich_100".
  async function confirmRoleImport(mode) {
    if (!rolePreview?.parsed) return;
    const filterFn = buildFilterFn();
    const { parsed, fileName } = rolePreview;
    const { newOwners, updatedOwners, allOwners, leads } = buildOwnersAndLeadsFromRole(
      parsed,
      owners,
      { sourceFile: fileName, filterFn },
    );
    // Commit the merge into App state — setOwners receives the full list.
    if (typeof setOwners === "function") setOwners(allOwners);
    if (typeof onAddLeads === "function" && leads.length) onAddLeads(leads);
    setEnrichNotice(
      `📥 Import terminé · ${newOwners.length} nouveau${newOwners.length > 1 ? "x" : ""} · `
      + `${updatedOwners.length} mis à jour · ${leads.length} propriété${leads.length > 1 ? "s" : ""} ajoutée${leads.length > 1 ? "s" : ""}.`
    );
    setTimeout(() => setEnrichNotice(""), 6000);
    setRolePreview(null);
    resetRoleFilters();

    // Kick off enrichment using the freshly merged owner list so we target
    // the just-imported records, not a stale snapshot.
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

  // ── Places enrichment ────────────────────────────────────────────────────

  // Run the lookup on an arbitrary list of target owners. `seedOwners` is
  // the "source of truth" owner list we mutate incrementally — defaults to
  // the current App state but the caller can pass the freshly-merged list
  // right after an import so we don't lose the rôle's newly added owners
  // in the first setOwners call.
  async function runEnrichment(targets, seedOwners) {
    if (typeof setOwners !== "function") return;
    if (!Array.isArray(targets) || !targets.length) {
      setEnrichNotice("Aucun investisseur à enrichir avec ces critères.");
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    const rowLookup = ownersToLookupRows(targets);
    if (!rowLookup.length) {
      setEnrichNotice("Aucun investisseur ciblé n'a une adresse postale exploitable.");
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    // Refuse to start if we're already past the daily cap — the backend
    // will 402 the request anyway, but surfacing it here keeps the UX
    // honest.
    const currentSpend = loadTodaySpend();
    if (currentSpend.estCost >= DAILY_SPEND_CAP_USD) {
      setEnrichNotice(`Plafond quotidien atteint (${formatCost(currentSpend.estCost)}). Réessayez demain.`);
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
            setEnrichNotice(data.error || "Budget quotidien Google Places atteint. Réessayez demain.");
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
        // Commit intermediate progress so the UI updates row-by-row —
        // matches PhoneFinder's per-batch setResultRuns pattern.
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
          ? `✅ ${totalFound} investisseur${totalFound > 1 ? "s" : ""} enrichi${totalFound > 1 ? "s" : ""} sur ${done}.`
          : `Aucun nouveau numéro trouvé sur ${done} recherche${done > 1 ? "s" : ""}.`
      );
      setTimeout(() => setEnrichNotice(""), 6000);
    }
  }

  // Public entry points for the two buttons.
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

  // ── Rendering ────────────────────────────────────────────────────────────

  return (
    <div className="om-shell">
      <style>{CSS}</style>

      <header className="om-head">
        <div>
          <div className="om-title">Investisseurs · {totals.owners}</div>
          <div className="om-sub">
            {totals.buildings} propriété{totals.buildings !== 1 ? "s" : ""} · {totals.phones} numéro{totals.phones !== 1 ? "s" : ""} tracé{totals.phones !== 1 ? "s" : ""}
            {totals.missing > 0 ? ` · ${totals.missing} sans numéro` : ""}
          </div>
        </div>
        <div className="om-hint">Un propriétaire = une adresse postale. Les compagnies à numéro sont regroupées comme aliases.</div>
      </header>

      <div className="om-toolbar">
        <input
          ref={searchRef}
          className="om-search"
          placeholder="🔍 Rechercher propriétaire, compagnie, téléphone… (⌘K)"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="om-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="all">Tous les statuts</option>
          {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="om-select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="all">Tous les numéros</option>
          <option value="missing">Numéro manquant</option>
          <option value="Excel">Excel</option>
          <option value="Places">Places</option>
          <option value="Manual">Manuel</option>
        </select>
        <select className="om-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="buildings">Tri: plus de propriétés</option>
          <option value="phones">Tri: plus de numéros</option>
          <option value="name">Tri: nom A–Z</option>
        </select>
        <button
          className="om-import-btn"
          onClick={pickRoleFile}
          disabled={roleBusy}
          title="Importe un rôle d'évaluation XLSX de la Ville (Longueuil, Montréal, etc.). Dédupe par adresse postale du propriétaire."
        >
          {roleBusy ? "Lecture…" : "📥 Importer un rôle"}
        </button>
        <button
          className="om-enrich-btn"
          onClick={enrichAll}
          disabled={enrichBusy || totals.missing === 0}
          title="Enrichit les numéros manquants via Google Places — une requête par investisseur."
        >
          {enrichBusy ? "Recherche…" : "🔍 Enrichir numéros manquants"}
        </button>
        <button
          className="om-test-btn"
          onClick={enrichTest100}
          disabled={enrichBusy || totals.missing === 0}
          title={`Teste la recherche Places sur les ${TEST_BATCH_SIZE} premiers investisseurs sans numéro pour mesurer le taux de succès avant un lot complet.`}
        >
          ▶︎ Tester 100 d'abord
        </button>
      </div>
      {enrichNotice && <div className="om-notice">{enrichNotice}</div>}
      {roleError && <div className="om-notice om-notice-err">⚠ {roleError}</div>}
      {enrichProgress && (
        <div className="om-progress">
          <div className="om-progress-row">
            <span>⏳ {enrichProgress.done} / {enrichProgress.total} · {enrichProgress.newlyFound} trouvé{enrichProgress.newlyFound !== 1 ? "s" : ""}</span>
            <span className="om-progress-spend">Aujourd'hui ~{formatCost(dailySpend.estCost)}</span>
          </div>
          <div className="om-progress-bar">
            <div style={{ width: `${Math.round((enrichProgress.done / Math.max(1, enrichProgress.total)) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* ── Rôle preview modal ──────────────────────────────────────────── */}
      {rolePreview && (() => {
        const stats = rolePreview.parsed.stats;
        const needLookup = stats.needLookup;
        const est = estimateLookupCost(needLookup);
        // Sanity check: show the first 5 owners' display names.
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
        return (
          <div className="mo" onClick={() => !roleBusy && setRolePreview(null)}>
            <div className="mo-box" onClick={e => e.stopPropagation()} style={{maxWidth:640}}>
              <div className="mo-title">Importer un rôle d'évaluation</div>
              <div className="mo-sub">
                <strong>{rolePreview.fileName}</strong>
              </div>
              <div className="mo-stats">
                <div><strong>{stats.properties.toLocaleString("fr-CA")}</strong> propriétés</div>
                <div><strong>{stats.uniquePostal.toLocaleString("fr-CA")}</strong> investisseurs uniques</div>
                <div>{stats.withPhone.toLocaleString("fr-CA")} avec numéro dans le rôle</div>
                <div style={{color:"#8D742D",fontWeight:700}}>{needLookup.toLocaleString("fr-CA")} à rechercher via Places</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>
                  Coût estimé de l'enrichissement: <strong>{formatCost(est.mid)}</strong> ({formatCost(est.lo)}–{formatCost(est.hi)})
                </div>
              </div>

              <div className="mo-sec-title">Aperçu — 5 premiers investisseurs</div>
              <ul className="mo-list">
                {firstFive.map((o, i) => (
                  <li key={i}>
                    <strong>{o.name}</strong>
                    <div style={{fontSize:11,color:"var(--text3)"}}>{o.address || "(adresse postale manquante)"}</div>
                    {o.phones.length > 0 && <div style={{fontSize:11,color:"var(--gold)"}}>📞 {o.phones.join(" · ")}</div>}
                  </li>
                ))}
              </ul>

              <div className="mo-sec-title">Filtres de ciblage (optionnels)</div>
              <div className="mo-filters">
                <label>
                  <span>Valeur de l'immeuble ≥</span>
                  <input type="number" placeholder="$" value={rfMinValue} onChange={e => setRfMinValue(e.target.value)} />
                </label>
                <label>
                  <span>Année de construction ≤</span>
                  <input type="number" placeholder="1970" value={rfMaxYear} onChange={e => setRfMaxYear(e.target.value)} />
                </label>
                <label>
                  <span>Inscrit au rôle avant</span>
                  <input type="number" placeholder="2005" value={rfInscriptionBefore} onChange={e => setRfInscriptionBefore(e.target.value)} />
                </label>
                <label>
                  <span>Unités entre</span>
                  <span style={{display:"flex",gap:6}}>
                    <input type="number" placeholder="min" value={rfUnitsMin} onChange={e => setRfUnitsMin(e.target.value)} style={{width:"50%"}} />
                    <input type="number" placeholder="max" value={rfUnitsMax} onChange={e => setRfUnitsMax(e.target.value)} style={{width:"50%"}} />
                  </span>
                </label>
                <div style={{fontSize:11,color:"var(--text3)",gridColumn:"1 / -1"}}>
                  Les filtres s'appliquent aux Leads (propriétés). Tous les investisseurs sont importés quoi qu'il arrive.
                </div>
              </div>

              <div className="mo-foot">
                <button className="btn" onClick={() => setRolePreview(null)} disabled={roleBusy}>Annuler</button>
                <button className="btn" onClick={() => confirmRoleImport("import_only")} disabled={roleBusy}>Importer seulement</button>
                <button className="btn" onClick={() => confirmRoleImport("import_enrich_100")} disabled={roleBusy}>Importer + tester 100</button>
                <button className="btn btn-gold" onClick={() => confirmRoleImport("import_enrich_all")} disabled={roleBusy}>Importer + enrichir tout</button>
              </div>
            </div>
          </div>
        );
      })()}

      {totals.owners === 0 ? (
        <div className="om-empty">
          <div style={{fontSize:15, fontWeight:600, marginBottom:6}}>Aucun investisseur pour le moment</div>
          <div>Importez un rôle d'évaluation via le bouton « Importer un rôle » ci-dessus, ou importez vos leads depuis la page « Leads ».</div>
        </div>
      ) : (
        <div className="om-grid">
          <section className="om-list">
            {filteredOwners.length === 0 ? (
              <div className="om-empty-small">Aucun investisseur ne correspond à « {debouncedSearch} »</div>
            ) : filteredOwners.map(o => {
              const s = stageCfg(o.stage || "new");
              const active = selected && selected.id === o.id;
              return (
                <button
                  key={o.id}
                  className={`om-row${active ? " active" : ""}`}
                  onClick={() => setSelectedId(o.id)}
                >
                  <div className="om-row-main">
                    <div className="om-row-name">{o.displayName || "(Propriétaire inconnu)"}</div>
                    <div className="om-row-sub">{formatPostalAddress(o) || describeOwnerKey(o.ownerKey)}</div>
                  </div>
                  <div className="om-row-meta">
                    <span className="om-badge">{o.buildings?.length || 0} propriété{(o.buildings?.length || 0) !== 1 ? "s" : ""}</span>
                    <span className="om-badge">{o.phones?.length || 0} tél</span>
                    <span className="om-pill" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                  </div>
                </button>
              );
            })}
          </section>

          <section className="om-fiche">
            {selected ? <OwnerFiche owner={selected} onUpdate={patch => updateOwner(selected.id, patch)} /> : (
              <div className="om-empty-small">Sélectionnez un investisseur à gauche pour voir sa fiche.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function OwnerFiche({ owner, onUpdate }) {
  const s = stageCfg(owner.stage || "new");
  const contactNames = Array.isArray(owner.contactNames) ? owner.contactNames : [];

  return (
    <div className="fiche-body">
      <header className="fiche-head">
        <div>
          <div className="fiche-name">{owner.displayName || "(Propriétaire inconnu)"}</div>
          <div className="fiche-addr">📍 {formatPostalAddress(owner) || describeOwnerKey(owner.ownerKey)}</div>
          {owner.matchedBusinessName ? (
            <div className="fiche-matched">
              Places a associé cet investisseur à : <strong>{owner.matchedBusinessName}</strong>
            </div>
          ) : null}
        </div>
        <div className="fiche-stage-wrap">
          <span className="om-pill" style={{ background: s.bg, color: s.color }}>{s.label}</span>
          <select
            className="om-select fiche-stage"
            value={owner.stage || "new"}
            onChange={e => onUpdate({ stage: e.target.value })}
          >
            {STAGES.map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
          </select>
        </div>
      </header>

      <div className="fiche-grid">
        <section className="fiche-sec">
          <div className="fiche-sec-title">
            Compagnies ({owner.aliases?.length || 0})
            <span className="fiche-sec-hint">Toutes les entités à numéro et fiducies de ce propriétaire</span>
          </div>
          {owner.aliases?.length ? (
            <ul className="fiche-list">
              {owner.aliases.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          ) : <div className="fiche-empty">Aucune compagnie recensée.</div>}
        </section>

        <section className="fiche-sec">
          <div className="fiche-sec-title">
            Téléphones ({owner.phones?.length || 0})
            <span className="fiche-sec-hint">Les badges indiquent la provenance de chaque numéro</span>
          </div>
          {owner.phones?.length ? (
            <ul className="fiche-list">
              {owner.phones.map((p, i) => {
                const src = sourceFor(owner, p);
                const cfg = SOURCE_CFG[src] || SOURCE_CFG.Migrated;
                return (
                  <li key={i} className="fiche-phone">
                    <a href={`tel:${String(p).replace(/\D+/g, "")}`} style={{color: "var(--blue)", textDecoration: "none", fontWeight: 600}}>{p}</a>
                    <span className="om-src-badge" style={{background: cfg.bg, color: cfg.color}} title={`Source: ${cfg.label}`}>{cfg.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : <div className="fiche-empty">Aucun numéro tracé pour l'instant.</div>}
        </section>

        <section className="fiche-sec">
          <div className="fiche-sec-title">
            Courriels ({owner.emails?.length || 0})
          </div>
          {owner.emails?.length ? (
            <ul className="fiche-list">
              {owner.emails.map((e, i) => <li key={i}><a href={`mailto:${e}`}>{e}</a></li>)}
            </ul>
          ) : <div className="fiche-empty">Aucun courriel.</div>}
        </section>

        {contactNames.length > 0 && (
          <section className="fiche-sec">
            <div className="fiche-sec-title">
              Personnes physiques ({contactNames.length})
              <span className="fiche-sec-hint">Les personnes identifiées à cette adresse postale (conjoints, etc.)</span>
            </div>
            <ul className="fiche-list">
              {contactNames.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </section>
        )}

        <section className="fiche-sec fiche-sec-wide">
          <div className="fiche-sec-title">
            Propriétés ({owner.buildings?.length || 0})
            <span className="fiche-sec-hint">Toutes les propriétés détenues par cet investisseur</span>
          </div>
          {owner.buildings?.length ? (
            <div className="bld-table-wrap">
              <table className="bld-table">
                <thead>
                  <tr>
                    <th>Adresse</th>
                    <th>Ville</th>
                    <th style={{textAlign:"right"}}>Unités</th>
                    <th>Utilisation</th>
                    <th style={{textAlign:"right"}}>Évaluation</th>
                    <th style={{textAlign:"right"}}>Construit</th>
                  </tr>
                </thead>
                <tbody>
                  {owner.buildings.map((b, i) => (
                    <tr key={b.id || i}>
                      <td>{b.address || b.buildingAddress || "—"}</td>
                      <td>{b.city || "—"}</td>
                      <td style={{textAlign:"right"}}>{b.units || "—"}</td>
                      <td>{b.utilisation || "—"}</td>
                      <td style={{textAlign:"right"}}>{b.assessment || "—"}</td>
                      <td style={{textAlign:"right"}}>{b.yearBuilt || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="fiche-empty">Aucune propriété enregistrée.</div>}
        </section>

        <section className="fiche-sec fiche-sec-wide">
          <div className="fiche-sec-title">Notes d'appel</div>
          <textarea
            className="fiche-textarea"
            placeholder="Notes d'appel, impressions, prochaine étape…"
            value={owner.callNotes || ""}
            onChange={e => onUpdate({ callNotes: e.target.value })}
          />
        </section>
      </div>
    </div>
  );
}

const CSS = `
.om-shell{display:flex;flex-direction:column;gap:14px;min-height:0;flex:1}
.om-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.om-title{font-size:20px;font-weight:700;color:var(--text)}
.om-sub{font-size:12px;color:var(--text3);margin-top:3px}
.om-hint{font-size:12px;color:var(--text2);max-width:440px;line-height:1.4;text-align:right}

.om-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.om-search{flex:1;min-width:240px;border:1px solid var(--border);background:#fff;border-radius:8px;padding:9px 12px;font-size:13px;outline:none}
.om-search:focus{border-color:#D9C07A;box-shadow:0 0 0 3px #F5EDD6}
.om-select{border:1px solid var(--border);background:#fff;border-radius:8px;padding:8px 10px;font-size:12px;outline:none;cursor:pointer}
.om-import-btn{border:1px solid var(--border);background:#fff;color:var(--text);border-radius:8px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.om-import-btn:hover:not(:disabled){background:#FAF8F4}
.om-import-btn:disabled{opacity:.5;cursor:not-allowed}
.om-enrich-btn{border:none;background:var(--gold);color:#fff;border-radius:8px;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.om-enrich-btn:hover:not(:disabled){filter:brightness(1.06)}
.om-enrich-btn:disabled{background:#D6D0BD;cursor:not-allowed}
.om-test-btn{border:1px solid var(--border);background:#fff;color:var(--text);border-radius:8px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.om-test-btn:hover:not(:disabled){background:#FAF8F4}
.om-test-btn:disabled{opacity:.5;cursor:not-allowed}
.om-notice{background:#F5EDD6;border:1px solid #E9D9AA;border-radius:8px;padding:9px 12px;font-size:12px;color:#8D742D;font-weight:600}
.om-notice-err{background:#FCE9E6;border-color:#F5C9C2;color:#A93425}

.om-progress{background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.om-progress-row{display:flex;justify-content:space-between;font-size:12px;color:var(--text2);font-weight:600}
.om-progress-spend{color:var(--text3);font-weight:500}
.om-progress-bar{height:6px;background:#F0EDE3;border-radius:999px;overflow:hidden}
.om-progress-bar > div{height:100%;background:var(--gold);border-radius:999px;transition:width .2s}

.om-empty{background:var(--card);border:1px dashed var(--border);border-radius:12px;padding:40px;text-align:center;color:var(--text2);line-height:1.5}
.om-empty-small{padding:24px;text-align:center;color:var(--text3);font-size:13px}

.om-grid{display:grid;grid-template-columns:minmax(340px, 380px) 1fr;gap:14px;min-height:0;flex:1}

.om-list{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-y:auto;min-height:0;max-height:calc(100vh - 240px)}
.om-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border:none;background:transparent;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s}
.om-row:last-child{border-bottom:none}
.om-row:hover{background:#FAF8F4}
.om-row.active{background:var(--gold-light)}
.om-row-main{min-width:0;flex:1}
.om-row-name{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.om-row-sub{font-size:11px;color:var(--text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.om-row-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
.om-badge{font-size:10px;padding:2px 6px;border-radius:6px;background:#F0EDE3;color:var(--text2);font-weight:600}
.om-pill{font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700;letter-spacing:.2px}
.om-src-badge{font-size:10px;padding:2px 7px;border-radius:999px;font-weight:700;letter-spacing:.2px}

.om-fiche{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-y:auto;min-height:0;max-height:calc(100vh - 240px)}
.fiche-body{padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.fiche-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:12px}
.fiche-name{font-size:20px;font-weight:700;color:var(--text)}
.fiche-addr{font-size:13px;color:var(--text2);margin-top:4px}
.fiche-matched{font-size:11px;color:var(--text3);margin-top:4px;font-style:italic}
.fiche-stage-wrap{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.fiche-stage{font-size:12px;padding:4px 8px}

.fiche-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.fiche-sec{background:#FAF8F4;border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.fiche-sec-wide{grid-column:1 / -1}
.fiche-sec-title{font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;display:flex;flex-direction:column;gap:2px}
.fiche-sec-hint{font-size:10px;font-weight:500;color:var(--text3);letter-spacing:0}
.fiche-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text)}
.fiche-list li{padding:4px 0;border-bottom:1px dashed var(--border)}
.fiche-list li:last-child{border-bottom:none}
.fiche-phone{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fiche-empty{font-size:12px;color:var(--text3);font-style:italic}

.bld-table-wrap{overflow-x:auto}
.bld-table{width:100%;border-collapse:collapse;font-size:12px}
.bld-table th{text-align:left;padding:8px 10px;background:#F0EDE3;color:var(--text2);font-weight:700;border-bottom:1px solid var(--border)}
.bld-table td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text)}
.bld-table tr:last-child td{border-bottom:none}

.fiche-textarea{width:100%;min-height:100px;border:1px solid var(--border);background:#fff;border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;resize:vertical}
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

@media (max-width: 1100px){
  .om-grid{grid-template-columns:1fr}
  .fiche-grid{grid-template-columns:1fr 1fr}
}
@media (max-width: 720px){
  .fiche-grid{grid-template-columns:1fr}
}
`;
