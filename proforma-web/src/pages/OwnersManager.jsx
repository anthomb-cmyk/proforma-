// Owners view — the primary CRM entity is now the investor (1 postal address
// = 1 person), not the individual building. An Owner can have many companies
// (aliases), many phone numbers, many buildings, and one mailing address.
//
// This page is a minimal, functional investor-centric view:
//   • Left column: owner list with search + sort
//   • Right column: owner fiche showing aliases (companies), phones, emails,
//     buildings, postal address, and call notes
//
// Owners come from App state (populated either via migration of existing
// leads or by the importer — see lib/ownerGrouping.js). Call notes and stage
// persist per-owner, not per-building.

import { useMemo, useState, useRef } from "react";
import useFocusHotkey from "../lib/useFocusHotkey.js";
import useDebouncedValue from "../lib/useDebouncedValue.js";
import { describeOwnerKey } from "../lib/ownerKey.js";
import { ownersToLookupRows, applyLookupResultsToOwners } from "../lib/ownerGrouping.js";

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

export default function OwnersManager({ owners = [], setOwners }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(owners[0]?.id || null);
  const [stageFilter, setStageFilter] = useState("all");
  const [sortBy, setSortBy] = useState("buildings"); // buildings | name | phones
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichNotice, setEnrichNotice] = useState("");
  const searchRef = useRef(null);
  useFocusHotkey(searchRef);

  const debouncedSearch = useDebouncedValue(search, 150);

  const filteredOwners = useMemo(() => {
    let list = Array.isArray(owners) ? [...owners] : [];
    if (stageFilter !== "all") {
      list = list.filter(o => (o.stage || "new") === stageFilter);
    }
    if (debouncedSearch) {
      list = list.filter(o => {
        if (matches(o.displayName, debouncedSearch)) return true;
        if ((o.aliases || []).some(a => matches(a, debouncedSearch))) return true;
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
  }, [owners, debouncedSearch, stageFilter, sortBy]);

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
    return { owners: owns.length, buildings, phones };
  }, [owners]);

  // Owner-level enrichment: send ONE synthesized row per owner (not one per
  // building) to /api/phone-lookup. For an investor holding 58 buildings this
  // collapses 58 API passes into 1 — the whole reason this screen exists.
  //
  // Targets owners that don't yet have a phone tracked AND have a mailing
  // address we can query against. Runs up to 50 at a time (the server's
  // batch cap).
  async function enrichPhones() {
    if (typeof setOwners !== "function") return;
    if (enrichBusy) return;
    const candidates = (owners || []).filter(o =>
      (!o.phones || o.phones.length === 0) && (o.postalAddress?.street || o.postalAddress?.postalCode)
    );
    if (!candidates.length) {
      setEnrichNotice("Tous les investisseurs avec adresse ont déjà au moins un numéro.");
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    const batch = candidates.slice(0, 50);
    const rowLookup = ownersToLookupRows(batch);
    if (!rowLookup.length) {
      setEnrichNotice("Aucun investisseur n'a une adresse postale exploitable.");
      setTimeout(() => setEnrichNotice(""), 4000);
      return;
    }
    setEnrichBusy(true);
    setEnrichNotice(`Recherche en cours pour ${rowLookup.length} investisseur${rowLookup.length > 1 ? "s" : ""}…`);
    try {
      const resp = await fetch("/api/phone-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowLookup.map(r => r.row) }),
      });
      const data = await resp.json();
      if (!data.ok) {
        if (resp.status === 402) {
          setEnrichNotice(data.error || "Budget quotidien Google Places atteint. Réessayez demain.");
          return;
        }
        setEnrichNotice(data.error || `Erreur serveur (${resp.status}).`);
        return;
      }
      const { owners: next, touched } = applyLookupResultsToOwners(owners, data.results || [], rowLookup);
      setOwners(next);
      setEnrichNotice(
        touched > 0
          ? `${touched} investisseur${touched > 1 ? "s" : ""} enrichi${touched > 1 ? "s" : ""}.`
          : "Aucun nouveau numéro trouvé."
      );
      setTimeout(() => setEnrichNotice(""), 5000);
    } catch (err) {
      setEnrichNotice(err?.message || "Connexion serveur impossible.");
    } finally {
      setEnrichBusy(false);
    }
  }

  return (
    <div className="om-shell">
      <style>{CSS}</style>

      <header className="om-head">
        <div>
          <div className="om-title">Investisseurs · {totals.owners}</div>
          <div className="om-sub">
            {totals.buildings} propriété{totals.buildings !== 1 ? "s" : ""} · {totals.phones} numéro{totals.phones !== 1 ? "s" : ""} tracé{totals.phones !== 1 ? "s" : ""}
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
        <select className="om-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="buildings">Tri: plus de propriétés</option>
          <option value="phones">Tri: plus de numéros</option>
          <option value="name">Tri: nom A–Z</option>
        </select>
        <button
          className="om-enrich-btn"
          onClick={enrichPhones}
          disabled={enrichBusy || totals.owners === 0}
          title="Enrichit les numéros de téléphone via Google Places — une requête par investisseur plutôt qu'une par immeuble."
        >
          {enrichBusy ? "Recherche…" : "☎ Enrichir les numéros"}
        </button>
      </div>
      {enrichNotice && <div className="om-notice">{enrichNotice}</div>}

      {totals.owners === 0 ? (
        <div className="om-empty">
          <div style={{fontSize:15, fontWeight:600, marginBottom:6}}>Aucun investisseur pour le moment</div>
          <div>Importez vos leads depuis la page « Leads » — ils seront automatiquement regroupés par adresse postale du propriétaire.</div>
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

  return (
    <div className="fiche-body">
      <header className="fiche-head">
        <div>
          <div className="fiche-name">{owner.displayName || "(Propriétaire inconnu)"}</div>
          <div className="fiche-addr">📍 {formatPostalAddress(owner) || describeOwnerKey(owner.ownerKey)}</div>
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
            <span className="fiche-sec-hint">Tous les numéros trouvés à travers les compagnies</span>
          </div>
          {owner.phones?.length ? (
            <ul className="fiche-list">
              {owner.phones.map((p, i) => (
                <li key={i}>
                  <a href={`tel:${String(p).replace(/\D+/g, "")}`} style={{color: "var(--blue)", textDecoration: "none", fontWeight: 600}}>{p}</a>
                </li>
              ))}
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
.om-enrich-btn{border:none;background:var(--gold);color:#fff;border-radius:8px;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.om-enrich-btn:hover:not(:disabled){filter:brightness(1.06)}
.om-enrich-btn:disabled{background:#D6D0BD;cursor:not-allowed}
.om-notice{background:#F5EDD6;border:1px solid #E9D9AA;border-radius:8px;padding:9px 12px;font-size:12px;color:#8D742D;font-weight:600}

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

.om-fiche{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-y:auto;min-height:0;max-height:calc(100vh - 240px)}
.fiche-body{padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.fiche-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:12px}
.fiche-name{font-size:20px;font-weight:700;color:var(--text)}
.fiche-addr{font-size:13px;color:var(--text2);margin-top:4px}
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
.fiche-empty{font-size:12px;color:var(--text3);font-style:italic}

.bld-table-wrap{overflow-x:auto}
.bld-table{width:100%;border-collapse:collapse;font-size:12px}
.bld-table th{text-align:left;padding:8px 10px;background:#F0EDE3;color:var(--text2);font-weight:700;border-bottom:1px solid var(--border)}
.bld-table td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text)}
.bld-table tr:last-child td{border-bottom:none}

.fiche-textarea{width:100%;min-height:100px;border:1px solid var(--border);background:#fff;border-radius:8px;padding:10px 12px;font-size:13px;font-family:inherit;outline:none;resize:vertical}
.fiche-textarea:focus{border-color:#D9C07A;box-shadow:0 0 0 3px #F5EDD6}

@media (max-width: 1100px){
  .om-grid{grid-template-columns:1fr}
  .fiche-grid{grid-template-columns:1fr 1fr}
}
@media (max-width: 720px){
  .fiche-grid{grid-template-columns:1fr}
}
`;
