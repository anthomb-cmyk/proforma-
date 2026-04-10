import { useState, useMemo, useCallback, useEffect, useRef } from "react";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Bebas+Neue&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#FAFAF9;
  --surface:#FFFFFF;
  --surface-2:#F9FAFB;
  --line:#E5E7EB;
  --line-2:#D1D5DB;
  --text:#111827;
  --text-2:#6B7280;
  --muted:#9CA3AF;
  --accent:#4F46E5;
  --accent-2:#EEF2FF;
  --green:#16A34A;
  --red:#DC2626;
  --blue:#2563EB;
  --amber:#D97706;
  --radius:12px;
  --radius-sm:10px;
  --shadow:0 1px 3px rgba(0,0,0,0.08);
}
html,body,#root{height:100%}
body{
  font-family:'Plus Jakarta Sans',sans-serif;
  background:var(--bg);
  color:var(--text);
  overflow:hidden;
}
button,input,select,textarea{font-family:inherit}

.app-shell{display:grid;grid-template-columns:280px 1fr;height:100vh}

.sidebar{
  background:var(--surface);
  border-right:1px solid var(--line);
  display:flex;
  flex-direction:column;
  min-height:0;
}
.sidebar-head{padding:20px 18px 14px;border-bottom:1px solid var(--line)}
.logo{font-size:20px;font-weight:700;letter-spacing:.2px;color:var(--accent)}
.logo small{color:var(--muted);font-weight:600;font-size:11px;display:block;margin-top:2px;letter-spacing:.5px;text-transform:uppercase}

.nav{padding:10px}
.nav-btn{
  width:100%;
  border:none;
  background:transparent;
  color:var(--text-2);
  display:flex;
  align-items:center;
  gap:10px;
  padding:10px 12px;
  border-radius:10px;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  transition:all .18s ease;
}
.nav-btn:hover{background:#F3F4F6;color:var(--text)}
.nav-btn.active{background:var(--accent-2);color:var(--accent)}

.sidebar-sec{padding:10px 18px 8px;font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.7px;text-transform:uppercase}
.deal-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 10px 12px}
.deal-item{
  border:1px solid transparent;
  background:transparent;
  border-radius:10px;
  padding:10px;
  margin-bottom:8px;
  cursor:pointer;
  transition:all .18s ease;
}
.deal-item:hover{background:#F9FAFB;border-color:var(--line);transform:translateX(3px)}
.deal-item.active{background:#EEF2FF;border-color:#C7D2FE}
.deal-title{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.deal-meta{margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.meta-text{font-size:11px;color:var(--text-2)}
.meta-contact{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}

.new-deal-btn{
  margin:12px;
  border:none;
  border-radius:10px;
  background:var(--accent);
  color:#fff;
  font-size:14px;
  font-weight:700;
  padding:11px 12px;
  cursor:pointer;
  box-shadow:var(--shadow);
}
.new-deal-btn:hover{filter:brightness(1.05)}

.main{display:flex;flex-direction:column;min-width:0}
.page-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:16px 24px;
  border-bottom:1px solid var(--line);
  background:var(--surface);
}
.page-title{font-size:22px;font-weight:700;letter-spacing:.2px}
.page-actions{display:flex;align-items:center;gap:8px}

.btn{border:1px solid var(--line);background:var(--surface);color:var(--text-2);padding:8px 12px;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer}
.btn:hover{background:#F9FAFB}
.btn-primary{border-color:transparent;background:var(--accent);color:#fff}
.btn-primary:hover{filter:brightness(1.05)}
.btn-danger{border-color:#FECACA;background:#FEF2F2;color:#B91C1C}
.btn-danger:hover{background:#FEE2E2}
.btn:disabled{opacity:.6;cursor:not-allowed}

.content{padding:24px;overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}

.kpi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.kpi-card{padding:16px;border-top:3px solid var(--accent)}
.kpi-label{font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-weight:700}
.kpi-value{font-size:36px;line-height:1;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--text);margin-top:8px}
.kpi-sub{font-size:12px;color:var(--text-2);margin-top:6px}

.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.section-title{font-size:14px;font-weight:700;color:var(--text)}

.list{display:flex;flex-direction:column;gap:8px}
.row-item{padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);display:flex;gap:10px;align-items:center;cursor:pointer;transition:all .15s}
.row-item:hover{border-color:var(--line-2);box-shadow:var(--shadow)}
.row-ico{width:34px;height:34px;border-radius:10px;background:#EEF2FF;color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.row-main{min-width:0;flex:1}
.row-title{font-size:13px;font-weight:700}
.row-sub{font-size:12px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.row-right{display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0}
.row-date{font-size:11px;color:var(--text-2);font-weight:600}

.pipeline-wrap{overflow-x:auto}
.pipeline-board{display:flex;gap:12px;min-width:max-content;align-items:flex-start}
.pipeline-col{width:220px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:10px;max-height:calc(100vh - 180px);overflow-y:auto}
.pipeline-col-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.pipeline-col-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--text)}
.count-badge{font-size:11px;font-weight:700;color:var(--text-2);padding:2px 8px;border-radius:999px;background:#F3F4F6}
.pipeline-card{padding:10px;border:1px solid var(--line);background:var(--surface);border-radius:10px;box-shadow:var(--shadow);cursor:pointer;transition:all .15s;margin-bottom:8px}
.pipeline-card:hover{transform:translateY(-1px);border-color:var(--line-2);box-shadow:0 4px 12px rgba(0,0,0,.08)}
.pipeline-title{font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pipeline-field{display:flex;justify-content:space-between;gap:8px;margin-top:4px}
.pipeline-field span:first-child{font-size:11px;color:var(--muted)}
.pipeline-field span:last-child{font-size:11px;color:var(--text-2);font-weight:600}
.pipeline-foot{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
.pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px}
.empty-col{font-size:11px;color:var(--muted);font-style:italic;padding:12px 0;text-align:center}

.workspace-title{font-size:24px;font-weight:700;border:none;background:transparent;outline:none;width:100%;padding:0}
.workspace-title:focus{border-bottom:1px solid #C7D2FE}

.stage-progress{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:var(--shadow)}
.stage-track{display:flex;gap:6px;overflow-x:auto}
.stage-chip{border:1px solid var(--line);background:var(--surface-2);color:var(--text-2);padding:7px 12px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.stage-chip.active{background:var(--accent-2);border-color:#C7D2FE;color:var(--accent)}

.tabbar{display:flex;gap:18px;border-bottom:1px solid var(--line);background:var(--surface);padding:0 8px}
.tab-btn{border:none;background:transparent;padding:12px 2px;color:var(--text-2);font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent}
.tab-btn.active{color:var(--accent);border-bottom-color:var(--accent)}

.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.form-card{padding:16px}
.form-title{font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px}
.field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
.field:last-child{margin-bottom:0}
.label{font-size:12px;color:var(--text-2);font-weight:600}
input,select,textarea{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;padding:9px 11px;font-size:13px;outline:none}
input:focus,select:focus,textarea:focus{border-color:#A5B4FC;box-shadow:0 0 0 3px #EEF2FF}
textarea{resize:vertical;min-height:130px;line-height:1.6}

.priority-row{display:flex;gap:6px}
.priority-btn{flex:1;border:1px solid var(--line);background:var(--surface-2);color:var(--text-2);padding:8px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer}

.ai-btn{border:none;border-radius:999px;background:var(--accent-2);color:var(--accent);padding:6px 11px;font-size:11px;font-weight:700;cursor:pointer}
.ai-btn.loading{opacity:.65;pointer-events:none}
.ai-box{margin-top:10px;padding:12px;border:1px solid #C7D2FE;background:var(--accent-2);border-radius:10px;font-size:13px;color:#3730A3;line-height:1.6}
.ai-label{font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:700;margin-bottom:6px}

.doc-drop{border:1.5px dashed #C7D2FE;background:#F8FAFF;border-radius:12px;padding:30px;text-align:center;cursor:pointer;transition:all .15s}
.doc-drop:hover,.doc-drop.drag{background:#EEF2FF;border-color:#A5B4FC}
.doc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}
.doc-card{position:relative;padding:12px;border:1px solid var(--line);background:var(--surface);border-radius:10px;box-shadow:var(--shadow);cursor:pointer}
.doc-card:hover{border-color:var(--line-2)}
.doc-icon{font-size:28px;text-align:center;margin-bottom:8px}
.doc-name{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc-meta{font-size:11px;color:var(--muted);margin-top:3px}
.doc-del{position:absolute;right:6px;top:6px;border:1px solid #FECACA;background:#FEF2F2;color:#B91C1C;border-radius:6px;padding:2px 6px;font-size:10px;cursor:pointer}

.pdf-viewer{margin-bottom:12px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
.pdf-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.pdf-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pdf-frame{width:100%;height:520px;border:none;background:#fff}

.stage-pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.stage-pill{border:1px solid var(--line);background:var(--surface-2);color:var(--text-2);padding:6px 11px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer}
.stage-pill.active{background:var(--accent-2);color:var(--accent);border-color:#C7D2FE}
.progress{height:6px;background:#EEF2FF;border-radius:999px;overflow:hidden;margin-bottom:10px}
.progress-bar{height:100%;background:var(--accent);transition:width .2s}
.check-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer}
.check-item:last-child{border-bottom:none}
.check-box{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--line-2);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.check-box.done{background:var(--accent);border-color:var(--accent);color:#fff}
.check-label{font-size:13px}
.check-label.done{text-decoration:line-through;color:var(--muted)}

.activity-item{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.activity-item:last-child{border-bottom:none}
.activity-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0}
.activity-text{font-size:13px;color:var(--text-2);flex:1}
.activity-time{font-size:11px;color:var(--muted);white-space:nowrap}
.quick-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.quick-btn{border:1px solid var(--line);background:var(--surface-2);color:var(--text-2);padding:6px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer}

.calendar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.calendar-month{font-size:22px;font-weight:700}
.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.day-label{font-size:11px;color:var(--muted);text-align:center;padding:4px 0;font-weight:700}
.day-cell{min-height:86px;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px;cursor:pointer}
.day-cell:hover{border-color:var(--line-2)}
.day-cell.today{border-color:#A5B4FC;background:#F8FAFF}
.day-cell.other{opacity:.45}
.day-num{font-size:12px;color:var(--text-2);font-weight:700;margin-bottom:5px}
.day-event{font-size:10px;padding:2px 6px;border-radius:6px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}
.day-event.type-deal{background:#EEF2FF;color:var(--accent)}
.day-event.type-followup{background:#FEF2F2;color:#B91C1C}
.day-event.type-google{background:#EFF6FF;color:#1D4ED8}

.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:56px 24px;min-height:300px}
.empty-icon{font-size:52px;animation:floaty 2.3s ease-in-out infinite;filter:drop-shadow(0 3px 8px rgba(79,70,229,.15))}
.empty-title{margin-top:10px;font-size:22px;font-weight:700;color:var(--text)}
.empty-sub{margin-top:6px;font-size:13px;color:var(--text-2);max-width:360px;line-height:1.6}

.modal{position:fixed;inset:0;background:rgba(250,250,249,.78);display:flex;align-items:center;justify-content:center;z-index:60}
.modal-box{width:460px;max-width:92vw;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.15);padding:22px}
.modal-title{font-size:22px;font-weight:700;margin-bottom:14px}
.modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}

.status-note{font-size:12px;color:var(--text-2);padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.status-note.error{color:#B91C1C;background:#FEF2F2;border-color:#FECACA}

@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

@media (max-width:1200px){
  .doc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:980px){
  .app-shell{grid-template-columns:1fr}
  .sidebar{display:none}
  .kpi-grid,.grid-2{grid-template-columns:1fr}
  .doc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`;

const STAGES = [
  { id: "prospection",   label: "Prospection",    color: "#6366f1", emoji: "🔍" },
  { id: "analyse",       label: "Analyse",         color: "#f59e0b", emoji: "📊" },
  { id: "offre",         label: "Offre déposée",   color: "#3b82f6", emoji: "📝" },
  { id: "due_diligence", label: "Due diligence",   color: "#8b5cf6", emoji: "🔬" },
  { id: "financement",   label: "Financement",     color: "#06b6d4", emoji: "🏦" },
  { id: "closing",       label: "Closing",         color: "#22c55e", emoji: "🤝" },
  { id: "perdu",         label: "Perdu",           color: "#ef4444", emoji: "✗"  },
];

const CHECKLISTS = {
  prospection:   ["Identifier la propriété","Valider le zonage","Vérifier historique MLS","Premier contact vendeur/courtier","Évaluer le quartier"],
  analyse:       ["Remplir le proforma","Valider loyers actuels","Analyser dépenses réelles","Calculer NOI et cap rate","Comparer ventes récentes"],
  offre:         ["Rédiger la promesse d'achat","Définir les conditions","Déposer l'offre","Négocier la contre-offre","Confirmer l'acceptation"],
  due_diligence: ["Commander l'inspection","Rapport environnemental","Vérifier les titres","Valider les baux","Inspecter la mécanique"],
  financement:   ["Demande de prêt soumise","Évaluation bancaire reçue","Approbation conditionnelle","Approbation finale","SCHL si requis"],
  closing:       ["Acte de vente signé","Virement de fonds","Remise des clés","Mise à jour assurances","Comptes de gestion ouverts"],
  perdu:         ["Documenter les raisons","Archiver les documents"],
};

const PRIORITY = {
  high:   { label: "Haute",   color: "#DC2626" },
  medium: { label: "Moyenne", color: "#D97706" },
  low:    { label: "Basse",   color: "#6B7280" },
};

function buildCL(stageId) {
  return (CHECKLISTS[stageId] || []).map((label, i) => ({ id: `${stageId}_${i}`, label, done: false }));
}

function createDeal(title) {
  const now = Date.now();
  return {
    id: `acq_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: title || "Nouveau deal",
    stage: "prospection", priority: "medium",
    createdAt: now, updatedAt: now,
    followUpDate: "", followUpNote: "", nextAction: "",
    contact: { name: "", phone: "", email: "", company: "", role: "" },
    notesDeal: "", notesVendeur: "",
    aiDeal: "", aiVendeur: "",
    files: [], activities: [], events: [],
    checklists: { prospection: buildCL("prospection") },
  };
}

const SK = "acq_crm_v4";
function load() { try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : null; } catch { return null; } }
function persist(s) { try { localStorage.setItem(SK, JSON.stringify(s)); } catch {} }

function fmtSz(b) { return b < 1048576 ? `${Math.round(b/1024)} KB` : `${(b/1048576).toFixed(1)} MB`; }
function fileIco(t) {
  if (t?.includes("pdf")) return "📄";
  if (t?.includes("image")) return "🖼️";
  if (t?.includes("word") || t?.includes("document")) return "📝";
  if (t?.includes("sheet") || t?.includes("excel")) return "📊";
  return "📎";
}

const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

function calDays(y, m) {
  const first = new Date(y, m, 1).getDay();
  const dim   = new Date(y, m + 1, 0).getDate();
  const dprev = new Date(y, m, 0).getDate();
  const days  = [];
  for (let i = first - 1; i >= 0; i--) days.push({ d: dprev - i, m: m - 1, y, other: true });
  for (let i = 1; i <= dim; i++)        days.push({ d: i, m, y, other: false });
  while (days.length < 42)              days.push({ d: days.length - dim - first + 1, m: m + 1, y, other: true });
  return days;
}
function dayKey({ d, m, y }) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function App() {
  const stored = load();
  const [deals, setDeals] = useState(stored?.deals || []);
  const [currentId, setCurrentId] = useState(stored?.currentId || null);
  const [gcalOk, setGcalOk] = useState(stored?.gcalOk || false);
  const [gcalEvents, setGcalEvents] = useState([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalError, setGcalError] = useState("");
  const [view, setView] = useState("dashboard");
  const [tab, setTab] = useState("crm");
  const [modal, setModal] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [clStage, setClStage] = useState("prospection");
  const [clNew, setClNew] = useState("");
  const [viewing, setViewing] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [calDate, setCalDate] = useState(new Date());
  const [newEv, setNewEv] = useState({ title:"", date:"", time:"", dealId:"" });
  const [aiLoadD, setAiLoadD] = useState(false);
  const [aiLoadV, setAiLoadV] = useState(false);
  const fileRef = useRef();

  useEffect(() => { persist({ deals, currentId, gcalOk }); }, [deals, currentId, gcalOk]);

  const current = useMemo(() => deals.find(d => d.id === currentId) || null, [deals, currentId]);

  const upd = useCallback((id, fn) => {
    setDeals(p => p.map(d => d.id === id ? { ...fn(d), updatedAt: Date.now() } : d));
  }, []);

  const addAct = useCallback((id, text) => {
    upd(id, d => ({ ...d, activities: [{ id: Date.now(), text, time: Date.now() }, ...(d.activities || [])] }));
  }, [upd]);

  const openDeal = (id) => {
    setCurrentId(id);
    setView("workspace");
    setTab("crm");
    setViewing(null);
  };

  const createDealFn = () => {
    const d = createDeal(newTitle.trim() || "Nouveau deal");
    setDeals(p => [d, ...p]);
    setCurrentId(d.id);
    setModal(null);
    setNewTitle("");
    setView("workspace");
    setTab("crm");
  };

  const deleteDeal = (id) => {
    if (!window.confirm("Supprimer ce deal ?")) return;
    setDeals(p => p.filter(d => d.id !== id));
    if (currentId === id) setCurrentId(deals.find(d => d.id !== id)?.id || null);
  };

  const setStage = (sid) => {
    if (!currentId) return;
    upd(currentId, d => ({
      ...d,
      stage: sid,
      checklists: { ...d.checklists, [sid]: d.checklists?.[sid] || buildCL(sid) }
    }));
    addAct(currentId, `Étape → ${STAGES.find(s => s.id === sid)?.label}`);
    setClStage(sid);
  };

  const toggleCL = (sid, iid) => {
    if (!currentId) return;
    upd(currentId, d => ({
      ...d,
      checklists: { ...d.checklists, [sid]: (d.checklists?.[sid] || []).map(i => i.id === iid ? { ...i, done: !i.done } : i) }
    }));
  };

  const handleFiles = useCallback(async (list) => {
    if (!currentId || !list?.length) return;
    const arr = Array.from(list);
    const done = await Promise.all(arr.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = e => res({
        id:`f_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        name:f.name,
        type:f.type,
        size:f.size,
        dataUrl:e.target.result,
        uploadedAt:Date.now()
      });
      r.readAsDataURL(f);
    })));
    upd(currentId, d => ({ ...d, files: [...(d.files || []), ...done] }));
    addAct(currentId, `📎 ${done.length} document${done.length>1?"s":""} ajouté${done.length>1?"s":""}: ${done.map(f=>f.name).join(", ")}`);
  }, [currentId, upd, addAct]);

  const delFile = (fid) => {
    if (!currentId) return;
    upd(currentId, d => ({ ...d, files: (d.files || []).filter(f => f.id !== fid) }));
    if (viewing?.id === fid) setViewing(null);
  };

  const aiSummarize = async (type) => {
    if (!current) return;
    const text = type === "deal" ? current.notesDeal : current.notesVendeur;
    if (!text?.trim()) { alert("Ajoutez des notes avant de résumer."); return; }
    type === "deal" ? setAiLoadD(true) : setAiLoadV(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content:
            type === "deal"
              ? `Expert en acquisition immobilière au Québec. Résume ces notes de deal en 3-5 points clés. Identifie opportunités et risques.\n\n${text}`
              : `Expert en négociation immobilière au Québec. Résume ces notes sur le vendeur en 3-5 points clés. Identifie motivation, contraintes et stratégies de négociation suggérées.\n\n${text}`
          }]
        })
      });
      const data = await res.json();
      const summary = data.content?.map(b => b.text || "").join("") || "Erreur API.";
      upd(current.id, d => ({ ...d, [type === "deal" ? "aiDeal" : "aiVendeur"]: summary }));
    } catch {
      upd(current.id, d => ({ ...d, [type === "deal" ? "aiDeal" : "aiVendeur"]: "Erreur de connexion à l'API Claude." }));
    } finally {
      type === "deal" ? setAiLoadD(false) : setAiLoadV(false);
    }
  };

  const connectGoogleCalendar = useCallback(() => {
    const clientId = "98847199802-fhl6ojdub1p3c38diqmlid95oqmfsi2o.apps.googleusercontent.com";
    if (!clientId) {
      setGcalError("REACT_APP_GCAL_CLIENT_ID manquant.");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setGcalError("Google OAuth non chargé. Rafraîchissez la page.");
      return;
    }
    setGcalLoading(true);
    setGcalError("");

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      callback: async (tokenResponse) => {
        if (tokenResponse?.error || !tokenResponse?.access_token) {
          setGcalOk(false);
          setGcalLoading(false);
          setGcalError("Authentification Google refusée ou invalide.");
          return;
        }
        try {
          const timeMin = new Date().toISOString();
          const query = new URLSearchParams({
            maxResults: "20",
            orderBy: "startTime",
            singleEvents: "true",
            timeMin,
          });
          const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query.toString()}`, {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          });
          if (!res.ok) throw new Error(`Google API ${res.status}`);
          const data = await res.json();
          const mapped = (data.items || []).map((event) => {
            if (!event.start?.dateTime && !event.start?.date) return null;
            return {
              id: event.id,
              title: event.summary || "(Sans titre)",
              date: event.start.dateTime ? event.start.dateTime.split("T")[0] : event.start.date,
              time: event.start.dateTime ? event.start.dateTime.split("T")[1].slice(0, 5) : "",
              type: "google",
              dealId: null,
            };
          }).filter(Boolean);
          setGcalEvents(mapped);
          setGcalOk(true);
        } catch {
          setGcalOk(false);
          setGcalEvents([]);
          setGcalError("Impossible de charger les événements Google Calendar.");
        } finally {
          setGcalLoading(false);
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: gcalOk ? "" : "consent" });
  }, [gcalOk]);

  const allEvents = useMemo(() => {
    const evs = [];
    deals.forEach(d => {
      if (d.followUpDate) evs.push({ id:`fu_${d.id}`, date:d.followUpDate, title:`🔔 ${d.title}`, type:"followup", dealId:d.id });
      (d.events || []).forEach(e => evs.push({ ...e, dealId:d.id }));
    });
    (gcalEvents || []).forEach(e => evs.push(e));
    return evs;
  }, [deals, gcalEvents]);

  const addEvent = () => {
    if (!newEv.title.trim() || !newEv.date) return;
    const did = newEv.dealId || currentId;
    if (!did) { alert("Associez l'événement à un deal."); return; }
    const normalizedDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(newEv.date)
      ? newEv.date
      : new Date(newEv.date).toISOString().split("T")[0];
    const ev = { id:`ev_${Date.now()}`, title:newEv.title, date:normalizedDate, time:newEv.time, type:"deal" };
    setDeals(prev => prev.map(d => d.id === did ? { ...d, events: [...(d.events || []), ev], updatedAt: Date.now() } : d));
    addAct(did, `📅 Événement: ${newEv.title} le ${normalizedDate}`);
    if (normalizedDate) {
      const [yy, mm] = normalizedDate.split("-").map(Number);
      if (yy && mm) setCalDate(new Date(yy, mm - 1, 1));
    }
    setNewEv({ title:"", date:"", time:"", dealId:"" });
    setModal(null);
  };

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return {
      total: deals.length,
      active: deals.filter(d => d.stage !== "perdu").length,
      overdue: deals.filter(d => d.followUpDate && new Date(d.followUpDate) < today).length,
      closing: deals.filter(d => d.stage === "closing").length,
    };
  }, [deals]);

  const followUps = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return deals.filter(d => d.followUpDate)
      .map(d => ({ ...d, diff: Math.ceil((new Date(d.followUpDate) - today) / 86400000) }))
      .sort((a,b) => a.diff - b.diff);
  }, [deals]);

  const pipeline = useMemo(() => {
    const map = {}; STAGES.forEach(s => { map[s.id] = []; });
    deals.forEach(d => {
      const key = d.stage || "prospection";
      (map[key] || map.prospection).push(d);
    });
    return map;
  }, [deals]);

  const todayStr = new Date().toISOString().split("T")[0];
  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  const days = calDays(y, m);

  const activeCL = current?.checklists?.[clStage] || [];
  const donePct = activeCL.length ? Math.round(activeCL.filter(i => i.done).length / activeCL.length * 100) : 0;
  const stageCL = current?.checklists?.[current?.stage] || [];
  const stagePct = stageCL.length ? Math.round(stageCL.filter(i => i.done).length / stageCL.length * 100) : 0;

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="logo">ACQUI.CRM<small>Business d'acquisition</small></div>
          </div>

          <div className="nav">
            {[
              { id:"dashboard", label:"Dashboard", icon:"📊" },
              { id:"pipeline", label:"Pipeline", icon:"🧩" },
              { id:"followups", label:"Follow-ups", icon:"⏰", badge: stats.overdue },
              { id:"calendar", label:"Calendrier", icon:"🗓️" },
            ].map(item => (
              <button key={item.id} className={`nav-btn${view===item.id?" active":""}`} onClick={() => setView(item.id)}>
                <span>{item.icon}</span>
                <span style={{flex:1,textAlign:"left"}}>{item.label}</span>
                {item.badge > 0 && <span className="count-badge" style={{background:"#FEE2E2",color:"#B91C1C"}}>{item.badge}</span>}
              </button>
            ))}
          </div>

          <div className="sidebar-sec">Deals récents</div>
          <div className="deal-scroll">
            {deals.length === 0 && <div className="status-note">Aucun deal encore.</div>}
            {deals.slice(0, 30).map(d => {
              const st = STAGES.find(s => s.id === d.stage) || STAGES[0];
              return (
                <div key={d.id} className={`deal-item${d.id===currentId && view==="workspace"?" active":""}`} onClick={() => openDeal(d.id)}>
                  <div className="deal-title">{d.title}</div>
                  <div className="deal-meta">
                    <div className="dot" style={{background:st.color}} />
                    <span className="meta-text">{st.label}</span>
                  </div>
                  <div className="meta-contact">{d.contact?.name || "Aucun contact"}</div>
                </div>
              );
            })}
          </div>

          <button className="new-deal-btn" onClick={() => setModal("new")}>＋ Nouveau deal</button>
        </aside>

        <main className="main">
          {view === "dashboard" && (
            <>
              <div className="page-head">
                <div className="page-title">Dashboard</div>
                <div className="page-actions">
                  <button className="btn btn-primary" onClick={() => setModal("new")}>＋ Nouveau deal</button>
                </div>
              </div>

              <div className="content">
                <div className="kpi-grid">
                  <div className="card kpi-card" style={{borderTopColor:"#4F46E5"}}><div className="kpi-label">Deals total</div><div className="kpi-value">{stats.total}</div><div className="kpi-sub">{stats.active} actifs</div></div>
                  <div className="card kpi-card" style={{borderTopColor:"#2563EB"}}><div className="kpi-label">En closing</div><div className="kpi-value">{stats.closing}</div><div className="kpi-sub">{pipeline.financement?.length || 0} en financement</div></div>
                  <div className="card kpi-card" style={{borderTopColor:"#DC2626"}}><div className="kpi-label">Follow-ups retard</div><div className="kpi-value">{stats.overdue}</div><div className="kpi-sub">{stats.overdue===0?"Tout à jour ✓":"Action requise"}</div></div>
                  <div className="card kpi-card" style={{borderTopColor:"#16A34A"}}><div className="kpi-label">Prospection</div><div className="kpi-value">{pipeline.prospection?.length || 0}</div><div className="kpi-sub">{pipeline.analyse?.length || 0} en analyse</div></div>
                </div>

                <div className="card" style={{padding:14}}>
                  <div className="section-head"><div className="section-title">Pipeline</div><button className="btn" onClick={() => setView("pipeline")}>Vue complète →</button></div>
                  <div className="pipeline-wrap">
                    <div className="pipeline-board">
                      {STAGES.filter(s => s.id !== "perdu").map(s => (
                        <div key={s.id} className="pipeline-col" style={{width:160}}>
                          <div className="pipeline-col-head"><div className="pipeline-col-label"><div className="dot" style={{background:s.color}} />{s.label}</div><span className="count-badge">{pipeline[s.id]?.length || 0}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {followUps.length > 0 && (
                  <div className="card" style={{padding:14}}>
                    <div className="section-head"><div className="section-title">Follow-ups</div><button className="btn" onClick={() => setView("followups")}>Voir tout →</button></div>
                    <div className="list">
                      {followUps.slice(0,4).map(d => {
                        const st = STAGES.find(s => s.id === d.stage) || STAGES[0];
                        const isOD = d.diff < 0;
                        const isToday = d.diff === 0;
                        return (
                          <div key={d.id} className="row-item" onClick={() => openDeal(d.id)}>
                            <div className="row-ico">{isOD?"⚠️":isToday?"🔔":"📅"}</div>
                            <div className="row-main"><div className="row-title">{d.title}</div><div className="row-sub">{d.followUpNote || "Suivi requis"}</div></div>
                            <div className="row-right">
                              <span className="pill" style={{background:st.color+"22",color:st.color}}>{st.label}</span>
                              <span className="row-date" style={{color:isOD?"#B91C1C":isToday?"#4F46E5":"#6B7280"}}>{isOD?`${Math.abs(d.diff)}j retard`:isToday?"Aujourd'hui":`Dans ${d.diff}j`}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {view === "pipeline" && (
            <>
              <div className="page-head">
                <div className="page-title">Pipeline</div>
                <div className="page-actions"><button className="btn btn-primary" onClick={() => setModal("new")}>＋ Nouveau deal</button></div>
              </div>
              <div className="content">
                <div className="pipeline-wrap">
                  <div className="pipeline-board">
                    {STAGES.map(s => {
                      const col = pipeline[s.id] || [];
                      return (
                        <div key={s.id} className="pipeline-col" style={{borderTop:`3px solid ${s.color}`}}>
                          <div className="pipeline-col-head">
                            <div className="pipeline-col-label"><div className="dot" style={{background:s.color}} />{s.label}</div>
                            <span className="count-badge">{col.length}</span>
                          </div>
                          {col.length === 0 && <div className="empty-col">Vide</div>}
                          {col.map(d => {
                            const today = new Date(); today.setHours(0,0,0,0);
                            const diff = d.followUpDate ? Math.ceil((new Date(d.followUpDate) - today) / 86400000) : null;
                            const isOD = d.followUpDate && new Date(d.followUpDate) < today;
                            const cl = d.checklists?.[d.stage] || [];
                            const clPct = cl.length ? Math.round(cl.filter(i => i.done).length / cl.length * 100) : null;
                            return (
                              <div key={d.id} className="pipeline-card" onClick={() => openDeal(d.id)}>
                                <div className="pipeline-title">{d.title}</div>
                                <div className="pipeline-field"><span>Contact</span><span>{d.contact?.name || "—"}</span></div>
                                {d.followUpDate && <div className="pipeline-field"><span>Suivi</span><span style={{color:isOD?"#B91C1C":"#6B7280"}}>{isOD?`⚠ ${Math.abs(diff)}j` : d.followUpDate}</span></div>}
                                <div className="pipeline-foot">
                                  <span className="pill" style={{background:PRIORITY[d.priority||"medium"].color+"22",color:PRIORITY[d.priority||"medium"].color}}>{PRIORITY[d.priority||"medium"].label}</span>
                                  {clPct !== null && <span className="pill" style={{background:"#F3F4F6",color:"#6B7280"}}>✓ {clPct}%</span>}
                                  {(d.files || []).length > 0 && <span className="pill" style={{background:"#F3F4F6",color:"#6B7280"}}>📎 {d.files.length}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "followups" && (
            <>
              <div className="page-head"><div className="page-title">Follow-ups</div></div>
              <div className="content">
                {followUps.length === 0 ? (
                  <div className="empty card">
                    <div className="empty-icon">📅</div>
                    <div className="empty-title">Aucun Follow-up</div>
                    <div className="empty-sub">Ajoutez une date de suivi dans l'onglet CRM d'un deal.</div>
                  </div>
                ) : (
                  <div className="list">
                    {followUps.map(d => {
                      const st = STAGES.find(s => s.id === d.stage) || STAGES[0];
                      const isOD = d.diff < 0;
                      const isToday = d.diff === 0;
                      return (
                        <div key={d.id} className="row-item" onClick={() => openDeal(d.id)}>
                          <div className="row-ico">{isOD?"⚠️":isToday?"🔔":"📅"}</div>
                          <div className="row-main"><div className="row-title">{d.title}</div><div className="row-sub">{d.followUpNote || "Suivi requis"}{d.contact?.name?` · ${d.contact.name}`:""}</div></div>
                          <div className="row-right">
                            <span className="pill" style={{background:st.color+"22",color:st.color}}>{st.label}</span>
                            <span className="row-date" style={{color:isOD?"#B91C1C":isToday?"#4F46E5":"#6B7280"}}>{isOD?`${Math.abs(d.diff)}j retard`:isToday?"Aujourd'hui":`Dans ${d.diff}j`}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {view === "calendar" && (
            <>
              <div className="page-head">
                <div className="page-title">Calendrier</div>
                <div className="page-actions">
                  <button className="btn" onClick={connectGoogleCalendar} disabled={gcalLoading}>{gcalLoading?"⏳ Connexion...":gcalOk?"🔄 Actualiser Google":"🔗 Google Calendar"}</button>
                  {gcalOk && !gcalLoading && <span style={{fontSize:12,color:"#16A34A",fontWeight:700}}>● Google connecté</span>}
                  <button className="btn btn-primary" onClick={() => setModal("event")}>＋ Événement</button>
                </div>
              </div>
              <div className="content">
                {gcalLoading && <div className="status-note">Chargement des événements Google Calendar…</div>}
                {gcalError && <div className="status-note error">{gcalError}</div>}

                <div className="card" style={{padding:14}}>
                  <div className="calendar-head">
                    <button className="btn" onClick={() => setCalDate(new Date(y, m - 1, 1))}>‹</button>
                    <div className="calendar-month">{MONTHS[m]} {y}</div>
                    <button className="btn" onClick={() => setCalDate(new Date(y, m + 1, 1))}>›</button>
                  </div>

                  <div className="calendar-grid">
                    {DAYS.map(d => <div key={d} className="day-label">{d}</div>)}
                    {days.map((d, i) => {
                      const k = dayKey(d);
                      const evs = allEvents.filter(e => e.date === k);
                      return (
                        <div key={i} className={`day-cell${k===todayStr?" today":""}${d.other?" other":""}`} onClick={() => { setNewEv(n => ({ ...n, date:k })); setModal("event"); }}>
                          <div className="day-num">{d.d}</div>
                          {evs.slice(0,2).map(ev => <div key={ev.id} className={`day-event type-${ev.type}`} title={ev.title}>{ev.title}</div>)}
                          {evs.length > 2 && <div style={{fontSize:10,color:"#9CA3AF"}}>+{evs.length - 2}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {allEvents.filter(e => e.date >= todayStr).length > 0 && (
                  <div className="card" style={{padding:14}}>
                    <div className="section-head"><div className="section-title">Prochains événements</div></div>
                    <div className="list">
                      {allEvents.filter(e => e.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date)).slice(0,8).map(ev => {
                        const deal = deals.find(d => d.id === ev.dealId);
                        const diff = Math.ceil((new Date(ev.date) - new Date(todayStr)) / 86400000);
                        return (
                          <div key={ev.id} className="row-item" onClick={() => ev.dealId && openDeal(ev.dealId)}>
                            <div className="row-ico">{ev.type==="followup"?"🔔":ev.type==="google"?"🗓️":"📅"}</div>
                            <div className="row-main"><div className="row-title">{ev.title}</div><div className="row-sub">{deal?.title || ""}{ev.time ? ` · ${ev.time}` : ""}</div></div>
                            <div className="row-date" style={{color:diff===0?"#4F46E5":"#6B7280"}}>{diff===0?"Aujourd'hui":`Dans ${diff}j`}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {view === "workspace" && (
            !current ? (
              <div className="content">
                <div className="empty card">
                  <div className="empty-icon">🏠</div>
                  <div className="empty-title">Aucun deal</div>
                  <div className="empty-sub">Sélectionnez un deal dans la barre de gauche.</div>
                  <button className="btn btn-primary" onClick={() => setModal("new")}>＋ Nouveau deal</button>
                </div>
              </div>
            ) : (
              <>
                <div className="page-head">
                  <div style={{minWidth:0,flex:1}}><input className="workspace-title" value={current.title} onChange={e => upd(current.id, d => ({ ...d, title:e.target.value }))} /></div>
                  <div className="page-actions">
                    <span style={{fontSize:11,color:"#9CA3AF",fontWeight:600}}>{new Date(current.updatedAt).toLocaleDateString("fr-CA")}</span>
                    <button className="btn" onClick={() => setModal("event")}>＋ Événement</button>
                    <button className="btn btn-danger" onClick={() => deleteDeal(current.id)}>Supprimer</button>
                  </div>
                </div>

                <div className="content">
                  <div className="stage-progress">
                    <div className="stage-track">
                      {STAGES.map(s => (
                        <button key={s.id} className={`stage-chip${current.stage===s.id?" active":""}`} onClick={() => setStage(s.id)}>
                          {s.emoji} {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="tabbar">
                    {[
                      ["crm", "CRM"],
                      ["notes", "Notes"],
                      ["documents", `Documents${(current.files || []).length > 0 ? ` (${current.files.length})` : ""}`],
                      ["checklist", `Checklist${stageCL.length > 0 ? ` ${stagePct}%` : ""}`],
                      ["activity", "Activité"],
                    ].map(([id, label]) => (
                      <button key={id} className={`tab-btn${tab===id?" active":""}`} onClick={() => setTab(id)}>{label}</button>
                    ))}
                  </div>

                  {tab === "crm" && (
                    <div className="grid-2">
                      <div className="card form-card">
                        <div className="form-title">Contact (vendeur / courtier)</div>
                        {[ ["name","Nom"], ["phone","Téléphone"], ["email","Email"], ["company","Compagnie"], ["role","Rôle"] ].map(([k, lbl]) => (
                          <div key={k} className="field">
                            <div className="label">{lbl}</div>
                            <input value={current.contact?.[k] || ""} onChange={e => upd(current.id, d => ({ ...d, contact:{ ...d.contact, [k]:e.target.value } }))} />
                          </div>
                        ))}
                      </div>

                      <div className="card form-card">
                        <div className="form-title">Suivi & Priorité</div>
                        <div className="field">
                          <div className="label">Priorité</div>
                          <div className="priority-row">
                            {Object.entries(PRIORITY).map(([k,{label,color}]) => (
                              <button key={k} className="priority-btn" style={current.priority===k?{background:color+"1A",borderColor:color,color}:undefined} onClick={() => upd(current.id, d => ({ ...d, priority:k }))}>{label}</button>
                            ))}
                          </div>
                        </div>
                        <div className="field"><div className="label">Date de follow-up</div><input type="date" value={current.followUpDate || ""} onChange={e => upd(current.id, d => ({ ...d, followUpDate:e.target.value }))} /></div>
                        <div className="field"><div className="label">Note de suivi</div><input value={current.followUpNote || ""} onChange={e => upd(current.id, d => ({ ...d, followUpNote:e.target.value }))} placeholder="Ex: Rappeler pour contre-offre…" /></div>
                        <div className="field"><div className="label">Prochaine action</div><input value={current.nextAction || ""} onChange={e => upd(current.id, d => ({ ...d, nextAction:e.target.value }))} placeholder="Ex: Déposer l'offre d'achat" /></div>
                      </div>

                      <div className="card form-card" style={{gridColumn:"1 / -1"}}>
                        <div className="form-title">Enregistrer une activité</div>
                        <ActivityLogger dealId={current.id} onLog={addAct} />
                      </div>
                    </div>
                  )}

                  {tab === "notes" && (
                    <div className="grid-2">
                      <div className="card form-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div className="form-title" style={{marginBottom:0}}>Notes deal</div>
                          <button className={`ai-btn${aiLoadD?" loading":""}`} onClick={() => aiSummarize("deal")}>{aiLoadD?"⏳ Analyse…":"✦ Résumer avec IA"}</button>
                        </div>
                        <textarea value={current.notesDeal || ""} onChange={e => upd(current.id, d => ({ ...d, notesDeal:e.target.value }))} placeholder="Prix demandé, état général, potentiel, quartier, historique, stratégie…" />
                        {current.aiDeal && <div className="ai-box"><div className="ai-label">✦ Résumé IA</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiDeal}</div><button className="btn" style={{marginTop:10}} onClick={() => upd(current.id, d => ({ ...d, aiDeal:"" }))}>Effacer</button></div>}
                      </div>

                      <div className="card form-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div className="form-title" style={{marginBottom:0}}>Notes vendeur</div>
                          <button className={`ai-btn${aiLoadV?" loading":""}`} onClick={() => aiSummarize("vendeur")}>{aiLoadV?"⏳ Analyse…":"✦ Résumer avec IA"}</button>
                        </div>
                        <textarea value={current.notesVendeur || ""} onChange={e => upd(current.id, d => ({ ...d, notesVendeur:e.target.value }))} placeholder="Motivation du vendeur, délai, flexibilité prix, points sensibles, style de négociation…" />
                        {current.aiVendeur && <div className="ai-box"><div className="ai-label">✦ Résumé IA</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiVendeur}</div><button className="btn" style={{marginTop:10}} onClick={() => upd(current.id, d => ({ ...d, aiVendeur:"" }))}>Effacer</button></div>}
                      </div>
                    </div>
                  )}

                  {tab === "documents" && (
                    <div>
                      {viewing && (
                        <div className="pdf-viewer">
                          <div className="pdf-bar">
                            <div className="pdf-name">📄 {viewing.name}</div>
                            <div style={{display:"flex",gap:8}}>
                              <a href={viewing.dataUrl} download={viewing.name}><button className="btn">⬇ Télécharger</button></a>
                              <button className="btn" onClick={() => setViewing(null)}>✕ Fermer</button>
                            </div>
                          </div>
                          {viewing.type?.includes("pdf")
                            ? <iframe src={viewing.dataUrl} className="pdf-frame" title={viewing.name} />
                            : viewing.type?.includes("image")
                            ? <img src={viewing.dataUrl} alt={viewing.name} style={{maxWidth:"100%",maxHeight:520,display:"block",margin:"0 auto",objectFit:"contain",background:"#fff"}} />
                            : <div style={{padding:20,fontSize:13,color:"#6B7280"}}>Prévisualisation non disponible. <a href={viewing.dataUrl} download={viewing.name} style={{color:"#4F46E5"}}>Télécharger le fichier</a></div>
                          }
                        </div>
                      )}

                      <div className={`doc-drop${dragging?" drag":""}`}
                        onDragOver={e => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
                        onClick={() => fileRef.current?.click()}>
                        <div style={{fontSize:30,marginBottom:8}}>📁</div>
                        <div style={{fontSize:14,fontWeight:700,color:"#111827"}}>Glissez vos fichiers ici ou cliquez pour sélectionner</div>
                        <div style={{fontSize:12,color:"#6B7280",marginTop:3}}>PDF, images, Word, Excel — tous formats acceptés</div>
                        <input ref={fileRef} type="file" multiple style={{display:"none"}} onChange={e => handleFiles(e.target.files)} />
                      </div>

                      {(current.files || []).length > 0 && (
                        <div className="doc-grid">
                          {current.files.map(f => (
                            <div key={f.id} className="doc-card" onClick={() => setViewing(f)}>
                              <div className="doc-icon">{fileIco(f.type)}</div>
                              <div className="doc-name" title={f.name}>{f.name}</div>
                              <div className="doc-meta">{fmtSz(f.size)} · {new Date(f.uploadedAt).toLocaleDateString("fr-CA")}</div>
                              <button className="doc-del" onClick={e => { e.stopPropagation(); delFile(f.id); }}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {(current.files || []).length === 0 && !viewing && <div className="status-note" style={{marginTop:10}}>Aucun document pour ce deal.</div>}
                    </div>
                  )}

                  {tab === "checklist" && (
                    <div className="card form-card">
                      <div className="form-title">Checklist par étape</div>

                      <div className="stage-pills">
                        {STAGES.map(s => {
                          const cl = current.checklists?.[s.id] || [];
                          const pct = cl.length ? Math.round(cl.filter(i => i.done).length / cl.length * 100) : null;
                          return (
                            <button key={s.id} className={`stage-pill${clStage===s.id?" active":""}`} onClick={() => {
                              setClStage(s.id);
                              if (!current.checklists?.[s.id]) upd(current.id, d => ({ ...d, checklists:{ ...d.checklists, [s.id]:buildCL(s.id) } }));
                            }}>{s.label}{pct!==null?` ${pct}%`:""}</button>
                          );
                        })}
                      </div>

                      {activeCL.length > 0 && (
                        <>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#6B7280",marginBottom:4,fontWeight:600}}>
                            <span>{activeCL.filter(i => i.done).length} / {activeCL.length}</span>
                            <span>{donePct}%</span>
                          </div>
                          <div className="progress"><div className="progress-bar" style={{width:`${donePct}%`}} /></div>
                        </>
                      )}

                      {activeCL.map(item => (
                        <div key={item.id} className="check-item" onClick={() => toggleCL(clStage, item.id)}>
                          <div className={`check-box${item.done?" done":""}`}>{item.done && "✓"}</div>
                          <span className={`check-label${item.done?" done":""}`}>{item.label}</span>
                        </div>
                      ))}

                      <div style={{display:"flex",gap:8,marginTop:10}}>
                        <input value={clNew} onChange={e => setClNew(e.target.value)} placeholder="Ajouter un item…" onKeyDown={e => {
                          if (e.key === "Enter" && clNew.trim()) {
                            upd(current.id, d => ({ ...d, checklists:{ ...d.checklists, [clStage]:[...(d.checklists?.[clStage] || []), { id:`c_${Date.now()}`, label:clNew.trim(), done:false }] } }));
                            setClNew("");
                          }
                        }} />
                        <button className="btn btn-primary" onClick={() => {
                          if (clNew.trim()) {
                            upd(current.id, d => ({ ...d, checklists:{ ...d.checklists, [clStage]:[...(d.checklists?.[clStage] || []), { id:`c_${Date.now()}`, label:clNew.trim(), done:false }] } }));
                            setClNew("");
                          }
                        }}>Ajouter</button>
                      </div>
                    </div>
                  )}

                  {tab === "activity" && (
                    <>
                      <div className="card form-card">
                        <div className="form-title">Enregistrer une activité</div>
                        <ActivityLogger dealId={current.id} onLog={addAct} />
                      </div>

                      <div className="card form-card">
                        <div className="form-title">Historique</div>
                        {(!current.activities || current.activities.length === 0)
                          ? <div className="status-note">Aucune activité encore.</div>
                          : current.activities.map(a => (
                            <div key={a.id} className="activity-item">
                              <div className="activity-dot" />
                              <div className="activity-text">{a.text}</div>
                              <div className="activity-time">{new Date(a.time).toLocaleString("fr-CA", { dateStyle:"short", timeStyle:"short" })}</div>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )
          )}
        </main>
      </div>

      {modal === "new" && (
        <div className="modal" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Nouveau deal</div>
            <div className="field">
              <div className="label">Nom / Adresse de la propriété</div>
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu" onKeyDown={e => e.key === "Enter" && createDealFn()} />
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={createDealFn}>Créer le deal</button>
            </div>
          </div>
        </div>
      )}

      {modal === "event" && (
        <div className="modal" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Nouvel événement</div>
            <div className="field"><div className="label">Titre</div><input autoFocus value={newEv.title} onChange={e => setNewEv(n => ({ ...n, title:e.target.value }))} placeholder="Ex: Inspection 320 rue Bouchard" /></div>
            <div className="field"><div className="label">Date</div><input type="date" value={newEv.date} onChange={e => setNewEv(n => ({ ...n, date:e.target.value }))} /></div>
            <div className="field"><div className="label">Heure (optionnel)</div><input type="time" value={newEv.time} onChange={e => setNewEv(n => ({ ...n, time:e.target.value }))} /></div>
            <div className="field">
              <div className="label">Associer à un deal</div>
              <select value={newEv.dealId || currentId || ""} onChange={e => setNewEv(n => ({ ...n, dealId:e.target.value }))}>
                <option value="">— Sélectionner —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={addEvent}>Créer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActivityLogger({ dealId, onLog }) {
  const [text, setText] = useState("");
  const QUICK = [
    "📞 Appel effectué",
    "📧 Email envoyé",
    "🤝 Rencontre faite",
    "💰 Offre déposée",
    "📋 Documents reçus",
    "🔍 Inspection faite",
    "🏦 Dossier financier soumis",
    "✅ Condition levée",
  ];

  return (
    <div>
      <div className="quick-actions">
        {QUICK.map(q => <button key={q} className="quick-btn" onClick={() => onLog(dealId, q)}>{q}</button>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Note personnalisée…" onKeyDown={e => {
          if (e.key === "Enter" && text.trim()) {
            onLog(dealId, text.trim());
            setText("");
          }
        }} />
        <button className="btn btn-primary" onClick={() => {
          if (text.trim()) {
            onLog(dealId, text.trim());
            setText("");
          }
        }}>Log</button>
      </div>
    </div>
  );
}
