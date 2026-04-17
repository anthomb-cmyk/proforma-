// Read/edit surface for a single lead. Purely presentational — the parent
// (LeadsManager) owns the data and passes handlers (onUpdate, onRemove,
// onCreateDeal, onMarkCall) plus config objects (stageCfg, callStatusCfg)
// and helpers (toDateTimeLocal, getPhones). Moving this out of App.js
// lets us ship LeadFiche changes without reloading the full ~4 k-line
// file into context.

export default function LeadFiche({ lead, stageCfg, callStatusCfg, onUpdate, onRemove, onCreateDeal, onMarkCall, toDateTimeLocal, getPhones }) {
  const leadPhones = getPhones(lead);
  const fmtAssessment = (v) => {
    if (!v) return "";
    const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n === 0) return v;
    return n >= 1000 ? `${(n / 1000).toFixed(0)} k$` : `${n} $`;
  };
  return (
    <>
      {/* Property card */}
      <div style={{background:"var(--surface,#FFFDF7)",border:"1.5px solid var(--gold,#C9A84C)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:800,color:"var(--text)",lineHeight:1.3}}>
              🏢 {lead.buildingAddress || lead.address || <span style={{color:"var(--text3)"}}>Adresse non renseignée</span>}
            </div>
            {(lead.city || lead.province || lead.postalCode) && (
              <div style={{fontSize:11,color:"var(--text2)",marginTop:3}}>
                📍 {[lead.city, lead.province, lead.postalCode].filter(Boolean).join("  ·  ")}
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:5,flexShrink:0}}>
            {!lead.linkedDealId && <button className="btn btn-sm btn-gold" onClick={() => onCreateDeal?.(lead)}>Créer deal</button>}
            {lead.linkedDealId && <span className="pill" style={{background:"#E9F7EF",color:"#1A7A3F",fontSize:10}}>Deal lié</span>}
            <button className="btn btn-sm btn-danger" onClick={() => onRemove(lead.id)}>✕</button>
          </div>
        </div>

        {/* Chips */}
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
          {lead.utilisation && <span style={{background:"#EEF2FF",color:"#3730A3",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>{lead.utilisation}</span>}
          {lead.units > 0 && <span style={{background:"#FFF7ED",color:"#C2410C",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>{lead.units} unité{lead.units > 1 ? "s" : ""}</span>}
          {lead.yearBuilt && <span style={{background:"#F0FDF4",color:"#166534",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>Construit {lead.yearBuilt}</span>}
          {lead.assessment && <span style={{background:"#FFF8F0",color:"#92400E",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>Éval. {fmtAssessment(lead.assessment)}</span>}
          {lead.lotArea && <span style={{background:"#F0F9FF",color:"#075985",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>Terrain {lead.lotArea}</span>}
        </div>

        {/* Owner / contact */}
        <div style={{marginTop:8,borderTop:"1px solid var(--border)",paddingTop:6,display:"flex",gap:12,flexWrap:"wrap"}}>
          {lead.companyName && <div style={{fontSize:12}}><span style={{color:"var(--text3)"}}>Propriétaire: </span><strong>{lead.companyName}</strong></div>}
          {lead.contactName && <div style={{fontSize:12}}><span style={{color:"var(--text3)"}}>Contact: </span><strong>{lead.contactName}</strong></div>}
          {lead.website && <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" style={{fontSize:12,color:"var(--blue)"}}>🌐 {lead.website.replace(/^https?:\/\//, "").split("/")[0]}</a>}
          {lead.matchedName && lead.matchedName !== lead.companyName && <div style={{fontSize:11,color:"var(--text3)"}}>Google: {lead.matchedName}{lead.confidence > 0 ? ` · ${Math.round(lead.confidence * 100)}%` : ""}</div>}
        </div>

        {/* Phones */}
        <div style={{marginTop:8,borderTop:"1px solid var(--border)",paddingTop:6,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {leadPhones.length > 0 ? (
            <>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",flex:1}}>
                {leadPhones.map((ph, idx) => (
                  <span key={idx} style={{background:idx===0?"var(--gold,#C9A84C)":"#F5F0E8",color:idx===0?"#fff":"var(--text)",fontWeight:700,fontSize:13,borderRadius:7,padding:"4px 10px",letterSpacing:"0.5px"}}>
                    📞 {ph}
                  </span>
                ))}
              </div>
              <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(leadPhones.join(" / "))}>📋</button>
            </>
          ) : <span style={{color:"var(--text3)",fontSize:12}}>Aucun numéro</span>}
          {lead.email && <span style={{fontSize:12,color:"var(--text2)"}}>✉ {lead.email}</span>}
        </div>
      </div>

      {/* Call controls */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8,marginBottom:10}}>
        <div className="f-row">
          <div className="f-lbl">Statut lead</div>
          <select value={lead.stage || "new"} onChange={e => onUpdate(lead.id, { stage: e.target.value })}>
            {Object.entries(stageCfg).map(([id, cfg]) => <option key={id} value={id}>{cfg.label}</option>)}
          </select>
        </div>
        <div className="f-row">
          <div className="f-lbl">Statut d'appel</div>
          <select value={lead.callStatus || "none"} onChange={e => onUpdate(lead.id, { callStatus: e.target.value })}>
            {Object.entries(callStatusCfg).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div className="f-row">
          <div className="f-lbl">Prochain rappel</div>
          <input type="datetime-local" value={toDateTimeLocal(lead.nextCallAt)} onChange={e => onUpdate(lead.id, { nextCallAt: e.target.value ? new Date(e.target.value).toISOString() : "" })} />
        </div>
      </div>

      <div style={{marginBottom:12,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <button className="btn btn-sm btn-gold" onClick={() => onMarkCall(lead)}>📞 Marquer appel maintenant</button>
        {lead.lastCallAt && <span style={{fontSize:11,color:"var(--text2)"}}>Dernier appel: {new Date(lead.lastCallAt).toLocaleString("fr-CA", { dateStyle:"short", timeStyle:"short" })}</span>}
      </div>

      {/* Notes */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:8}}>
        <div className="f-row" style={{marginBottom:0}}>
          <div className="f-lbl">Notes générales</div>
          <textarea style={{minHeight:90}} placeholder="Infos utiles sur ce lead…" value={lead.notes || ""} onChange={e => onUpdate(lead.id, { notes: e.target.value })} />
        </div>
        <div className="f-row" style={{marginBottom:0}}>
          <div className="f-lbl">Notes d'appel</div>
          <textarea style={{minHeight:90}} placeholder="Script, suivi d'appel, réponse obtenue…" value={lead.callNotes || ""} onChange={e => onUpdate(lead.id, { callNotes: e.target.value })} />
        </div>
      </div>
      <div style={{marginTop:8,fontSize:10,color:"var(--text3)"}}>
        Source: {lead.sourceFile || "manuelle"}{lead.createdAt ? ` · importé le ${new Date(lead.createdAt).toLocaleString("fr-CA", { dateStyle:"short", timeStyle:"short" })}` : ""}
      </div>
    </>
  );
}
