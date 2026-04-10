import { useState, useMemo, useCallback, useEffect, useRef } from "react";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0b0c10;--bg2:#111318;--bg3:#181920;--bg4:#1e1f28;
  --br:#252630;--br2:#2e3040;
  --acc:#e8c468;--acc2:#f5d87a;
  --text:#dde1f0;--t2:#8a8fa8;--t3:#4a4e63;
  --green:#22c55e;--red:#ef4444;--blue:#60a5fa;--purple:#a78bfa;--cyan:#22d3ee;
  --r:8px;--rlg:14px;--rsm:5px;
  --fh:'Bebas Neue',sans-serif;--fb:'Outfit',sans-serif;--fm:'JetBrains Mono',monospace;
}
body,#root{font-family:var(--fb);background:var(--bg);color:var(--text);font-size:13px;height:100vh;overflow:hidden}
.shell{display:grid;grid-template-columns:240px 1fr;height:100vh;overflow:hidden}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--br2);border-radius:2px}
.sb{background:var(--bg2);border-right:1px solid var(--br);display:flex;flex-direction:column;overflow:hidden}
.sb-hd{padding:20px 16px 14px;border-bottom:1px solid var(--br)}
.sb-logo{font-family:var(--fh);font-size:28px;letter-spacing:2px;color:var(--text);line-height:1}
.sb-logo em{color:var(--acc);font-style:normal}
.sb-tag{font-size:10px;color:var(--t3);letter-spacing:1.5px;text-transform:uppercase;margin-top:4px}
.sb-nav{padding:10px 8px;border-bottom:1px solid var(--br)}
.snb{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border-radius:var(--r);background:transparent;border:none;color:var(--t2);font-size:13px;font-weight:500;cursor:pointer;text-align:left;transition:all .13s;font-family:var(--fb)}
.snb.active{background:var(--acc)18;color:var(--acc);border:1px solid var(--acc)30}
.snb:hover:not(.active){background:var(--bg3);color:var(--text)}
.sb-sec{font-size:9px;color:var(--t3);letter-spacing:1.2px;text-transform:uppercase;padding:12px 16px 5px}
.sdl{padding:8px 10px;margin:0 6px;border-radius:var(--r);cursor:pointer;border:1px solid transparent;transition:all .12s}
.sdl:hover{background:var(--bg3)}
.sdl.active{background:var(--bg3);border-color:var(--br2)}
.sdl-title{font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sdl-meta{display:flex;align-items:center;gap:5px;margin-top:3px}
.sdl-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.sdl-sub{font-size:10px;color:var(--t3)}
.scrl{overflow-y:auto;flex:1;min-height:0;padding:4px 0 8px}
.sb-add{margin:8px;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--r);background:var(--acc)14;border:1px dashed var(--acc)50;color:var(--acc);font-size:13px;font-weight:600;cursor:pointer;width:calc(100% - 16px);font-family:var(--fb);transition:all .15s}
.sb-add:hover{background:var(--acc)22}
.main{background:var(--bg);overflow:hidden;display:flex;flex-direction:column}
.scr{overflow-y:auto;flex:1;min-height:0}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid var(--br);background:var(--bg2);flex-shrink:0;gap:12px}
.tb-left{display:flex;align-items:center;gap:12px;min-width:0;flex:1}
.tb-title{font-family:var(--fh);font-size:22px;letter-spacing:1.5px;white-space:nowrap}
.tb-right{display:flex;gap:8px;align-items:center;flex-shrink:0}
.tabrow{display:flex;gap:1px;padding:0 22px;background:var(--bg2);border-bottom:1px solid var(--br);flex-shrink:0;overflow-x:auto}
.tbtn{padding:10px 16px;background:transparent;border:none;color:var(--t3);font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid transparent;transition:all .13s;font-family:var(--fb);position:relative;bottom:-1px;white-space:nowrap}
.tbtn.active{color:var(--acc);border-bottom-color:var(--acc)}
.tbtn:hover:not(.active){color:var(--t2)}
.btn{padding:8px 16px;border-radius:var(--r);font-size:12px;font-weight:600;cursor:pointer;transition:all .13s;font-family:var(--fb);letter-spacing:.3px;border:none}
.btn-gold{background:var(--acc);color:#0b0c10}
.btn-gold:hover{background:var(--acc2)}
.btn-ghost{background:transparent;color:var(--t2);border:1px solid var(--br2)}
.btn-ghost:hover{background:var(--bg3);color:var(--text)}
.btn-danger{background:var(--red)18;color:var(--red);border:1px solid var(--red)35}
.btn-danger:hover{background:var(--red)28}
.btn-sm{padding:5px 11px;font-size:11px}
.pill{display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.3px}
.dash{padding:20px 22px;display:flex;flex-direction:column;gap:18px}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.kpi{background:var(--bg2);border:1px solid var(--br);border-radius:var(--rlg);padding:16px 18px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.kpi.gold::before{background:var(--acc)}
.kpi.green::before{background:var(--green)}
.kpi.red::before{background:var(--red)}
.kpi.blue::before{background:var(--blue)}
.kpi-lbl{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.kpi-val{font-family:var(--fh);font-size:30px;letter-spacing:1px;color:var(--text);line-height:1}
.kpi-sub{font-size:11px;color:var(--t3);margin-top:5px}
.sec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sec-title{font-family:var(--fh);font-size:16px;letter-spacing:1px}
.fu-list{display:flex;flex-direction:column;gap:7px}
.fu-item{background:var(--bg2);border:1px solid var(--br);border-radius:var(--rlg);padding:13px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:border-color .13s}
.fu-item:hover{border-color:var(--br2)}
.fu-item.overdue{border-left:3px solid var(--red)}
.fu-item.today{border-left:3px solid var(--acc)}
.fu-ico{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.fu-body{flex:1;min-width:0}
.fu-title{font-size:13px;font-weight:500}
.fu-sub{font-size:11px;color:var(--t3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fu-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
.fu-date{font-family:var(--fm);font-size:11px}
.pipe-wrap{padding:18px 22px;overflow-x:auto;height:100%}
.pipe-cols{display:flex;gap:10px;min-width:max-content;align-items:flex-start}
.pipe-col{background:var(--bg2);border:1px solid var(--br);border-radius:var(--rlg);padding:12px;width:190px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 130px);overflow-y:auto}
.pipe-col-hd{display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.pc-label{font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px}
.pc-count{font-size:10px;color:var(--t3);background:var(--bg3);padding:2px 7px;border-radius:10px}
.pc-card{background:var(--bg3);border:1px solid var(--br);border-radius:var(--r);padding:11px;cursor:pointer;transition:all .13s}
.pc-card:hover{border-color:var(--br2);transform:translateY(-1px)}
.pc-title{font-size:12px;font-weight:600;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc-row{display:flex;justify-content:space-between;margin-top:3px}
.pc-mkey{font-size:10px;color:var(--t3)}
.pc-mval{font-size:10px;font-family:var(--fm)}
.pc-foot{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px;border-top:1px solid var(--br);padding-top:6px}
.pc-empty{font-size:11px;color:var(--t3);text-align:center;padding:12px 0;opacity:.5;font-style:italic}
.ws{padding:18px 22px;display:flex;flex-direction:column;gap:14px}
.title-inp{background:transparent;border:none;color:var(--text);font-family:var(--fh);font-size:22px;letter-spacing:1.5px;width:100%;padding:0;cursor:text;outline:none}
.title-inp:focus{border-bottom:1px solid var(--acc)60}
.ws-stage-bar{display:flex;gap:4px;overflow-x:auto;padding:10px 22px;background:var(--bg2);border-bottom:1px solid var(--br);flex-shrink:0}
.ws-stbtn{padding:6px 13px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid var(--br);background:transparent;color:var(--t3);cursor:pointer;white-space:nowrap;transition:all .13s;font-family:var(--fb)}
.ws-stbtn:hover:not(.st-active){border-color:var(--br2);color:var(--t2)}
.ccard{background:var(--bg2);border:1px solid var(--br);border-radius:var(--rlg);padding:16px}
.ccard-title{font-size:9px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:14px}
.crm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.notes-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.frow{display:flex;flex-direction:column;gap:3px;margin-bottom:10px}
.frow:last-child{margin-bottom:0}
.flbl{font-size:10px;color:var(--t3);margin-bottom:2px}
input,select{font-family:var(--fb);background:var(--bg3);border:1px solid var(--br);color:var(--text);border-radius:var(--rsm);padding:7px 10px;font-size:13px;width:100%;outline:none;transition:border .13s}
input:focus,select:focus{border-color:var(--acc)80}
textarea{font-family:var(--fb);background:var(--bg3);border:1px solid var(--br);color:var(--text);border-radius:var(--rsm);padding:9px 12px;font-size:13px;width:100%;outline:none;transition:border .13s;resize:vertical;line-height:1.7}
textarea:focus{border-color:var(--acc)80}
.ai-btn{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;background:var(--purple)18;border:1px solid var(--purple)40;color:var(--purple);font-size:10px;font-weight:600;letter-spacing:.3px;cursor:pointer;transition:all .13s;font-family:var(--fb)}
.ai-btn:hover{background:var(--purple)28}
.ai-btn.loading{opacity:.5;pointer-events:none}
.ai-box{background:var(--bg3);border:1px solid var(--purple)30;border-radius:var(--r);padding:14px;font-size:13px;color:var(--t2);line-height:1.7;margin-top:10px}
.ai-box-lbl{font-size:9px;color:var(--purple);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600}
.doc-drop{border:1.5px dashed var(--br2);border-radius:var(--rlg);padding:28px;text-align:center;cursor:pointer;transition:all .15s;background:var(--bg2)}
.doc-drop:hover,.doc-drop.drag{border-color:var(--acc)70;background:var(--acc)08}
.doc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-top:14px}
.doc-card{background:var(--bg2);border:1px solid var(--br);border-radius:var(--r);padding:13px;cursor:pointer;transition:all .13s;position:relative}
.doc-card:hover{border-color:var(--br2);transform:translateY(-1px)}
.doc-icon{font-size:26px;margin-bottom:8px;text-align:center}
.doc-name{font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
.doc-meta{font-size:10px;color:var(--t3)}
.doc-del{position:absolute;top:6px;right:6px;background:var(--red)20;border:1px solid var(--red)40;color:var(--red);border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;opacity:0;transition:opacity .13s;font-family:var(--fb)}
.doc-card:hover .doc-del{opacity:1}
.pdf-viewer{background:var(--bg3);border:1px solid var(--br);border-radius:var(--rlg);overflow:hidden;margin-bottom:14px}
.pdf-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--br)}
.pdf-name{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.pdf-frame{width:100%;height:520px;border:none;background:#fff}
.cl-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px}
.cl-tab{padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid var(--br);background:transparent;color:var(--t3);cursor:pointer;font-family:var(--fb);transition:all .13s}
.cl-tab.active{color:#0b0c10;border-color:transparent}
.cl-tab:hover:not(.active){color:var(--t2);border-color:var(--br2)}
.cl-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--br)40;cursor:pointer}
.cl-item:last-child{border-bottom:none}
.cl-box{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--br2);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .13s}
.cl-box.done{background:var(--green);border-color:var(--green)}
.cl-label{font-size:13px;flex:1;transition:all .13s}
.cl-label.done{color:var(--t3);text-decoration:line-through}
.cl-progress{height:3px;background:var(--bg3);border-radius:2px;margin-bottom:12px;overflow:hidden}
.cl-bar{height:100%;background:var(--green);border-radius:2px;transition:width .3s}
.act-item{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--br)30}
.act-item:last-child{border-bottom:none}
.act-dot{width:7px;height:7px;border-radius:50%;background:var(--acc);flex-shrink:0;margin-top:4px}
.act-text{font-size:12px;color:var(--t2);flex:1}
.act-time{font-size:10px;color:var(--t3);font-family:var(--fm);white-space:nowrap}
.qa-wrap{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.qa-btn{padding:5px 10px;border-radius:20px;background:var(--bg3);border:1px solid var(--br);color:var(--t2);font-size:11px;cursor:pointer;font-family:var(--fb);transition:all .13s}
.qa-btn:hover{background:var(--bg4);color:var(--text);border-color:var(--br2)}
.cal-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.cal-month{font-family:var(--fh);font-size:22px;letter-spacing:1px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal-dlbl{font-size:10px;color:var(--t3);text-align:center;padding:4px 0;text-transform:uppercase;letter-spacing:.5px}
.cal-day{min-height:70px;background:var(--bg2);border:1px solid var(--br);border-radius:var(--r);padding:7px;cursor:pointer;transition:all .13s}
.cal-day:hover{border-color:var(--br2)}
.cal-day.is-today{border-color:var(--acc)60;background:var(--acc)08}
.cal-day.other-m{opacity:.3}
.cal-dnum{font-size:12px;color:var(--t2);margin-bottom:4px;font-family:var(--fm)}
.cal-day.is-today .cal-dnum{color:var(--acc);font-weight:600}
.cal-ev{font-size:9px;border-radius:3px;padding:1px 5px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.cal-ev.type-deal{background:var(--acc)20;color:var(--acc)}
.cal-ev.type-followup{background:var(--red)18;color:var(--red)}
.cal-ev.type-google{background:var(--blue)20;color:var(--blue)}
.pri-btns{display:flex;gap:6px}
.pri-btn{flex:1;padding:7px;border-radius:var(--r);font-size:11px;font-weight:600;border:1px solid var(--br);background:var(--bg3);color:var(--t3);cursor:pointer;font-family:var(--fb);transition:all .13s;text-align:center}
.mo{position:fixed;inset:0;background:#00000090;display:flex;align-items:center;justify-content:center;z-index:200}
.mo-box{background:var(--bg2);border:1px solid var(--br2);border-radius:var(--rlg);padding:26px;width:440px;max-width:92vw;box-shadow:0 20px 60px #00000080}
.mo-title{font-family:var(--fh);font-size:22px;letter-spacing:1px;margin-bottom:18px}
.mo-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:40px}
.empty-ico{font-size:44px;opacity:.3}
.empty-title{font-family:var(--fh);font-size:20px;letter-spacing:1px;color:var(--t2)}
.empty-sub{font-size:12px;color:var(--t3);text-align:center;line-height:1.7;max-width:280px}
.code-block{background:var(--bg3);border:1px solid var(--br2);border-radius:var(--r);padding:12px 16px;font-family:var(--fm);font-size:11px;color:var(--t2);white-space:pre;overflow-x:auto;line-height:1.8;margin:10px 0}
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
  high:   { label: "Haute",   color: "#ef4444" },
  medium: { label: "Moyenne", color: "#f59e0b" },
  low:    { label: "Basse",   color: "#6b7280" },
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
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

export default function AcquisitionCRM() {
  const stored = load();
  const [deals, setDeals]         = useState(stored?.deals || []);
  const [currentId, setCurrentId] = useState(stored?.currentId || null);
  const [gcalOk, setGcalOk]       = useState(stored?.gcalOk || false);
  const [view, setView]           = useState("dashboard");
  const [tab,  setTab]            = useState("crm");
  const [modal, setModal]         = useState(null);
  const [newTitle, setNewTitle]   = useState("");
  const [clStage, setClStage]     = useState("prospection");
  const [clNew,   setClNew]       = useState("");
  const [viewing, setViewing]     = useState(null);
  const [dragging,setDragging]    = useState(false);
  const [calDate, setCalDate]     = useState(new Date());
  const [newEv,   setNewEv]       = useState({ title:"", date:"", time:"", dealId:"" });
  const [aiLoadD, setAiLoadD]     = useState(false);
  const [aiLoadV, setAiLoadV]     = useState(false);
  const fileRef = useRef();

  useEffect(() => { persist({ deals, currentId, gcalOk }); }, [deals, currentId, gcalOk]);

  const current = useMemo(() => deals.find(d => d.id === currentId) || null, [deals, currentId]);

  const upd = useCallback((id, fn) => {
    setDeals(p => p.map(d => d.id === id ? { ...fn(d), updatedAt: Date.now() } : d));
  }, []);

  const addAct = useCallback((id, text) => {
    upd(id, d => ({ ...d, activities: [{ id: Date.now(), text, time: Date.now() }, ...(d.activities||[])] }));
  }, [upd]);

  const openDeal = (id) => { setCurrentId(id); setView("workspace"); setTab("crm"); setViewing(null); };

  const createDealFn = () => {
    const d = createDeal(newTitle.trim() || "Nouveau deal");
    setDeals(p => [d, ...p]);
    setCurrentId(d.id);
    setModal(null); setNewTitle("");
    setView("workspace"); setTab("crm");
  };

  const deleteDeal = (id) => {
    if (!window.confirm("Supprimer ce deal ?")) return;
    setDeals(p => p.filter(d => d.id !== id));
    if (currentId === id) setCurrentId(deals.find(d => d.id !== id)?.id || null);
  };

  const setStage = (sid) => {
    if (!currentId) return;
    upd(currentId, d => ({ ...d, stage: sid, checklists: { ...d.checklists, [sid]: d.checklists?.[sid] || buildCL(sid) } }));
    addAct(currentId, `Étape → ${STAGES.find(s => s.id === sid)?.label}`);
    setClStage(sid);
  };

  const toggleCL = (sid, iid) => {
    if (!currentId) return;
    upd(currentId, d => ({
      ...d,
      checklists: { ...d.checklists, [sid]: (d.checklists?.[sid]||[]).map(i => i.id === iid ? { ...i, done: !i.done } : i) }
    }));
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (list) => {
    if (!currentId || !list?.length) return;
    const arr = Array.from(list);
    const done = await Promise.all(arr.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = e => res({ id:`f_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name:f.name, type:f.type, size:f.size, dataUrl:e.target.result, uploadedAt:Date.now() });
      r.readAsDataURL(f);
    })));
    upd(currentId, d => ({ ...d, files: [...(d.files||[]), ...done] }));
    addAct(currentId, `📎 ${done.length} document${done.length>1?"s":""} ajouté${done.length>1?"s":""}: ${done.map(f=>f.name).join(", ")}`);
  }, [currentId, upd, addAct]);

  const delFile = (fid) => {
    if (!currentId) return;
    upd(currentId, d => ({ ...d, files: (d.files||[]).filter(f => f.id !== fid) }));
    if (viewing?.id === fid) setViewing(null);
  };

  // ── AI summarize ───────────────────────────────────────────────────────────
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
      const summary = data.content?.map(b => b.text||"").join("") || "Erreur API.";
      upd(current.id, d => ({ ...d, [type==="deal"?"aiDeal":"aiVendeur"]: summary }));
    } catch {
      upd(current.id, d => ({ ...d, [type==="deal"?"aiDeal":"aiVendeur"]: "Erreur de connexion à l'API Claude." }));
    } finally {
      type === "deal" ? setAiLoadD(false) : setAiLoadV(false);
    }
  };

  // ── Calendar ───────────────────────────────────────────────────────────────
  const allEvents = useMemo(() => {
    const evs = [];
    deals.forEach(d => {
      if (d.followUpDate) evs.push({ id:`fu_${d.id}`, date:d.followUpDate, title:`🔔 ${d.title}`, type:"followup", dealId:d.id });
      (d.events||[]).forEach(e => evs.push({ ...e, dealId:d.id }));
    });
    return evs;
  }, [deals]);

  const addEvent = () => {
    if (!newEv.title.trim() || !newEv.date) return;
    const did = newEv.dealId || currentId;
    if (!did) { alert("Associez l'événement à un deal."); return; }
    const ev = { id:`ev_${Date.now()}`, title:newEv.title, date:newEv.date, time:newEv.time, type:"deal" };
    upd(did, d => ({ ...d, events: [...(d.events||[]), ev] }));
    addAct(did, `📅 Événement: ${newEv.title} le ${newEv.date}`);
    setNewEv({ title:"", date:"", time:"", dealId:"" });
    setModal(null);
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
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
      .map(d => ({ ...d, diff: Math.ceil((new Date(d.followUpDate)-today)/86400000) }))
      .sort((a,b) => a.diff - b.diff);
  }, [deals]);

  const pipeline = useMemo(() => {
    const m = {}; STAGES.forEach(s => { m[s.id] = []; });
    deals.forEach(d => { const k = d.stage||"prospection"; (m[k]||m.prospection).push(d); });
    return m;
  }, [deals]);

  const todayStr = new Date().toISOString().split("T")[0];
  const y = calDate.getFullYear(), mo = calDate.getMonth();
  const days = calDays(y, mo);

  const activeCL    = current?.checklists?.[clStage] || [];
  const donePct     = activeCL.length ? Math.round(activeCL.filter(i=>i.done).length/activeCL.length*100) : 0;
  const stageCL     = current?.checklists?.[current?.stage] || [];
  const stagePct    = stageCL.length ? Math.round(stageCL.filter(i=>i.done).length/stageCL.length*100) : 0;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="shell">

        {/* ─ Sidebar ─ */}
        <aside className="sb">
          <div className="sb-hd">
            <div className="sb-logo">ACQUI<em>.</em>CRM</div>
            <div className="sb-tag">Business d'acquisition</div>
          </div>
          <div className="sb-nav">
            {[
              { id:"dashboard", label:"Dashboard",  ico:"⊞" },
              { id:"pipeline",  label:"Pipeline",   ico:"◈" },
              { id:"followups", label:"Follow-ups", ico:"◷", badge:stats.overdue },
              { id:"calendar",  label:"Calendrier", ico:"📅" },
            ].map(({id,label,ico,badge}) => (
              <button key={id} className={`snb${view===id?" active":""}`} onClick={()=>setView(id)}>
                <span style={{width:18,textAlign:"center"}}>{ico}</span>
                <span style={{flex:1}}>{label}</span>
                {badge>0 && <span style={{background:"var(--red)",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10,fontFamily:"var(--fm)"}}>{badge}</span>}
              </button>
            ))}
          </div>
          <div className="sb-sec">Deals récents</div>
          <div className="scrl">
            {deals.length===0 && <div style={{padding:"8px 16px",fontSize:11,color:"var(--t3)"}}>Aucun deal encore.</div>}
            {deals.slice(0,30).map(d => {
              const st = STAGES.find(s=>s.id===d.stage)||STAGES[0];
              const today = new Date(); today.setHours(0,0,0,0);
              const diff = d.followUpDate ? Math.ceil((new Date(d.followUpDate)-today)/86400000) : null;
              return (
                <div key={d.id} className={`sdl${d.id===currentId&&view==="workspace"?" active":""}`} onClick={()=>openDeal(d.id)}>
                  <div className="sdl-title">{d.title}</div>
                  <div className="sdl-meta">
                    <div className="sdl-dot" style={{background:st.color}}/>
                    <span className="sdl-sub">{st.label}</span>
                    {diff!==null&&diff<=0 && <span style={{color:"var(--red)",fontSize:9,fontFamily:"var(--fm)"}}>● retard</span>}
                    {diff!==null&&diff>0&&diff<=3 && <span style={{color:"var(--acc)",fontSize:9,fontFamily:"var(--fm)"}}>● {diff}j</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="sb-add" onClick={()=>setModal("new")}>＋ Nouveau deal</button>
        </aside>

        {/* ─ Main ─ */}
        <main className="main">

          {/* ── Dashboard ── */}
          {view==="dashboard" && <>
            <div className="topbar">
              <div className="tb-left"><div className="tb-title">DASHBOARD</div></div>
              <div className="tb-right"><button className="btn btn-gold" onClick={()=>setModal("new")}>＋ Nouveau deal</button></div>
            </div>
            <div className="scr"><div className="dash">
              <div className="kpi-row">
                <div className="kpi gold"><div className="kpi-lbl">Deals total</div><div className="kpi-val">{stats.total}</div><div className="kpi-sub">{stats.active} actifs</div></div>
                <div className="kpi blue"><div className="kpi-lbl">En closing</div><div className="kpi-val">{stats.closing}</div><div className="kpi-sub">{pipeline.financement?.length||0} en financement</div></div>
                <div className="kpi red"><div className="kpi-lbl">Follow-ups retard</div><div className="kpi-val" style={{color:stats.overdue>0?"var(--red)":"var(--green)"}}>{stats.overdue}</div><div className="kpi-sub">{stats.overdue===0?"Tout à jour ✓":"Action requise!"}</div></div>
                <div className="kpi green"><div className="kpi-lbl">Prospection</div><div className="kpi-val">{pipeline.prospection?.length||0}</div><div className="kpi-sub">{pipeline.analyse?.length||0} en analyse</div></div>
              </div>

              {/* Pipeline mini */}
              <div>
                <div className="sec-hd"><div className="sec-title">PIPELINE</div><button className="btn btn-ghost btn-sm" onClick={()=>setView("pipeline")}>Vue complète →</button></div>
                <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
                  {STAGES.filter(s=>s.id!=="perdu").map(s => (
                    <div key={s.id} style={{background:"var(--bg2)",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:"10px 14px",minWidth:115,flexShrink:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:s.color}}/>
                        <span style={{fontSize:10,fontWeight:600,color:"var(--t2)"}}>{s.label}</span>
                      </div>
                      <div style={{fontFamily:"var(--fh)",fontSize:28,letterSpacing:1}}>{pipeline[s.id]?.length||0}</div>
                    </div>
                  ))}
                </div>
              </div>

              {followUps.length>0 && <div>
                <div className="sec-hd"><div className="sec-title">FOLLOW-UPS</div><button className="btn btn-ghost btn-sm" onClick={()=>setView("followups")}>Voir tout →</button></div>
                <div className="fu-list">
                  {followUps.slice(0,4).map(d => {
                    const isOD=d.diff<0,isT=d.diff===0;
                    const st=STAGES.find(s=>s.id===d.stage);
                    return (
                      <div key={d.id} className={`fu-item${isOD?" overdue":isT?" today":""}`} onClick={()=>openDeal(d.id)}>
                        <div className="fu-ico" style={{background:isOD?"var(--red)18":isT?"var(--acc)18":"var(--bg3)"}}>{isOD?"⚠️":isT?"🔔":"📅"}</div>
                        <div className="fu-body"><div className="fu-title">{d.title}</div><div className="fu-sub">{d.followUpNote||"Suivi requis"}{d.contact?.name?` · ${d.contact.name}`:""}</div></div>
                        <div className="fu-right">
                          <span className="pill" style={{background:st?.color+"22",color:st?.color}}>{st?.label}</span>
                          <span className="fu-date" style={{color:isOD?"var(--red)":isT?"var(--acc)":"var(--t2)"}}>{isOD?`${Math.abs(d.diff)}j retard`:isT?"Aujourd'hui":`Dans ${d.diff}j`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              {allEvents.filter(e=>e.date>=todayStr).length>0 && <div>
                <div className="sec-hd"><div className="sec-title">PROCHAINS ÉVÉNEMENTS</div><button className="btn btn-ghost btn-sm" onClick={()=>setView("calendar")}>Calendrier →</button></div>
                {allEvents.filter(e=>e.date>=todayStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3).map(ev => {
                  const deal=deals.find(d=>d.id===ev.dealId);
                  const diff=Math.ceil((new Date(ev.date)-new Date(todayStr))/86400000);
                  return (
                    <div key={ev.id} className="fu-item" style={{marginBottom:6}} onClick={()=>ev.dealId&&openDeal(ev.dealId)}>
                      <div className="fu-ico" style={{background:"var(--blue)18"}}>📅</div>
                      <div className="fu-body"><div className="fu-title">{ev.title}</div><div className="fu-sub">{deal?.title||""}{ev.time?` · ${ev.time}`:""}</div></div>
                      <span className="fu-date" style={{color:diff===0?"var(--acc)":"var(--t2)"}}>{diff===0?"Aujourd'hui":`Dans ${diff}j`}</span>
                    </div>
                  );
                })}
              </div>}
            </div></div>
          </>}

          {/* ── Pipeline ── */}
          {view==="pipeline" && <>
            <div className="topbar">
              <div className="tb-left"><div className="tb-title">PIPELINE</div></div>
              <div className="tb-right"><button className="btn btn-gold" onClick={()=>setModal("new")}>＋ Nouveau deal</button></div>
            </div>
            <div className="scr"><div className="pipe-wrap"><div className="pipe-cols">
              {STAGES.map(s => {
                const col=pipeline[s.id]||[];
                return (
                  <div key={s.id} className="pipe-col">
                    <div className="pipe-col-hd">
                      <div className="pc-label"><div style={{width:7,height:7,borderRadius:"50%",background:s.color}}/>{s.label}</div>
                      <span className="pc-count">{col.length}</span>
                    </div>
                    {col.length===0 && <div className="pc-empty">Vide</div>}
                    {col.map(d => {
                      const today=new Date();today.setHours(0,0,0,0);
                      const isOD=d.followUpDate&&new Date(d.followUpDate)<today;
                      const cl=d.checklists?.[d.stage]||[];
                      const clPct=cl.length?Math.round(cl.filter(i=>i.done).length/cl.length*100):null;
                      const diff=d.followUpDate?Math.ceil((new Date(d.followUpDate)-today)/86400000):null;
                      return (
                        <div key={d.id} className="pc-card" onClick={()=>openDeal(d.id)}>
                          <div className="pc-title">{d.title}</div>
                          {d.contact?.name && <div className="pc-row"><span className="pc-mkey">Contact</span><span className="pc-mval">{d.contact.name}</span></div>}
                          {d.followUpDate && <div className="pc-row"><span className="pc-mkey">Suivi</span><span className="pc-mval" style={{color:isOD?"var(--red)":"var(--t2)"}}>{isOD?`⚠ ${Math.abs(diff)}j retard`:d.followUpDate}</span></div>}
                          {d.nextAction && <div style={{fontSize:10,color:"var(--t3)",marginTop:5,fontStyle:"italic",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>→ {d.nextAction}</div>}
                          <div className="pc-foot">
                            <span className="pill" style={{background:PRIORITY[d.priority||"medium"].color+"20",color:PRIORITY[d.priority||"medium"].color,fontSize:9}}>{PRIORITY[d.priority||"medium"].label}</span>
                            {clPct!==null && <span className="pill" style={{background:"var(--bg3)",color:clPct===100?"var(--green)":"var(--t3)",fontSize:9}}>✓ {clPct}%</span>}
                            {(d.files||[]).length>0 && <span className="pill" style={{background:"var(--bg3)",color:"var(--t3)",fontSize:9}}>📎 {d.files.length}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div></div></div>
          </>}

          {/* ── Follow-ups ── */}
          {view==="followups" && <>
            <div className="topbar"><div className="tb-left"><div className="tb-title">FOLLOW-UPS</div></div></div>
            <div className="scr"><div className="dash">
              {followUps.length===0
                ? <div className="empty"><div className="empty-ico">📅</div><div className="empty-title">AUCUN FOLLOW-UP</div><div className="empty-sub">Ajoutez une date de suivi dans l'onglet CRM d'un deal.</div></div>
                : <div className="fu-list">{followUps.map(d => {
                    const isOD=d.diff<0,isT=d.diff===0;
                    const st=STAGES.find(s=>s.id===d.stage)||STAGES[0];
                    return (
                      <div key={d.id} className={`fu-item${isOD?" overdue":isT?" today":""}`} onClick={()=>openDeal(d.id)}>
                        <div className="fu-ico" style={{background:isOD?"var(--red)18":isT?"var(--acc)18":"var(--bg3)"}}>{isOD?"⚠️":isT?"🔔":"📅"}</div>
                        <div className="fu-body"><div className="fu-title">{d.title}</div><div className="fu-sub">{d.followUpNote||"Suivi requis"}{d.contact?.name?` · ${d.contact.name}`:""}</div></div>
                        <div className="fu-right">
                          <span className="pill" style={{background:st.color+"22",color:st.color,border:`1px solid ${st.color}40`}}>{st.label}</span>
                          <span className="fu-date" style={{color:isOD?"var(--red)":isT?"var(--acc)":"var(--t2)"}}>{isOD?`${Math.abs(d.diff)}j retard`:isT?"Aujourd'hui":`Dans ${d.diff}j`}</span>
                        </div>
                      </div>
                    );
                  })}</div>}
            </div></div>
          </>}

          {/* ── Calendar ── */}
          {view==="calendar" && <>
            <div className="topbar">
              <div className="tb-left"><div className="tb-title">CALENDRIER</div></div>
              <div className="tb-right">
                {!gcalOk && <button className="btn btn-ghost btn-sm" onClick={()=>setModal("gcal")}>🔗 Google Calendar</button>}
                {gcalOk  && <span style={{fontSize:11,color:"var(--green)"}}>● Google Calendar connecté</span>}
                <button className="btn btn-gold btn-sm" onClick={()=>setModal("event")}>＋ Événement</button>
              </div>
            </div>
            <div className="scr"><div className="dash">
              <div>
                <div className="cal-hd">
                  <button className="btn btn-ghost btn-sm" onClick={()=>setCalDate(new Date(y,mo-1,1))}>‹</button>
                  <div className="cal-month">{MONTHS[mo]} {y}</div>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setCalDate(new Date(y,mo+1,1))}>›</button>
                </div>
                <div className="cal-grid">
                  {DAYS.map(d => <div key={d} className="cal-dlbl">{d}</div>)}
                  {days.map((d,i) => {
                    const k=dayKey(d);
                    const evs=allEvents.filter(e=>e.date===k);
                    return (
                      <div key={i} className={`cal-day${k===todayStr?" is-today":""}${d.other?" other-m":""}`}
                        onClick={()=>{ setNewEv(n=>({...n,date:k})); setModal("event"); }}>
                        <div className="cal-dnum">{d.d}</div>
                        {evs.slice(0,2).map(ev => (
                          <div key={ev.id} className={`cal-ev type-${ev.type}`} title={ev.title}>{ev.title}</div>
                        ))}
                        {evs.length>2 && <div style={{fontSize:9,color:"var(--t3)"}}>+{evs.length-2}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {allEvents.filter(e=>e.date>=todayStr).length>0 && <div>
                <div className="sec-hd"><div className="sec-title">PROCHAINS ÉVÉNEMENTS</div></div>
                <div className="fu-list">
                  {allEvents.filter(e=>e.date>=todayStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8).map(ev => {
                    const deal=deals.find(d=>d.id===ev.dealId);
                    const diff=Math.ceil((new Date(ev.date)-new Date(todayStr))/86400000);
                    return (
                      <div key={ev.id} className="fu-item" onClick={()=>ev.dealId&&openDeal(ev.dealId)}>
                        <div className="fu-ico" style={{background:ev.type==="followup"?"var(--red)18":ev.type==="google"?"var(--blue)18":"var(--acc)18"}}>
                          {ev.type==="followup"?"🔔":ev.type==="google"?"🗓️":"📅"}
                        </div>
                        <div className="fu-body"><div className="fu-title">{ev.title}</div><div className="fu-sub">{deal?.title||""}{ev.time?` · ${ev.time}`:""}</div></div>
                        <span className="fu-date" style={{color:diff===0?"var(--acc)":"var(--t2)"}}>{diff===0?"Aujourd'hui":`Dans ${diff}j`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>}
            </div></div>
          </>}

          {/* ── Workspace ── */}
          {view==="workspace" && <>
            {!current
              ? <div className="empty"><div className="empty-ico">🏠</div><div className="empty-title">AUCUN DEAL</div><div className="empty-sub">Sélectionnez un deal dans la barre de gauche.</div><button className="btn btn-gold" onClick={()=>setModal("new")}>＋ Nouveau deal</button></div>
              : <>
                <div className="topbar">
                  <div className="tb-left">
                    <input className="title-inp" value={current.title} onChange={e=>upd(current.id,d=>({...d,title:e.target.value}))}/>
                  </div>
                  <div className="tb-right">
                    <span style={{fontFamily:"var(--fm)",fontSize:10,color:"var(--t3)"}}>{new Date(current.updatedAt).toLocaleDateString("fr-CA")}</span>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setModal("event")}>＋ Événement</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>deleteDeal(current.id)}>Supprimer</button>
                  </div>
                </div>

                {/* Stage bar */}
                <div className="ws-stage-bar">
                  {STAGES.map(s => {
                    const active=current.stage===s.id;
                    const cl=current.checklists?.[s.id]||[];
                    const pct=cl.length?Math.round(cl.filter(i=>i.done).length/cl.length*100):null;
                    return (
                      <button key={s.id} className={`ws-stbtn${active?" st-active":""}`}
                        style={active?{background:s.color,color:"#0b0c10",borderColor:s.color}:{}}
                        onClick={()=>setStage(s.id)}>
                        {s.emoji} {s.label}
                        {pct!==null&&!active && <span style={{marginLeft:4,opacity:.55,fontSize:9,fontFamily:"var(--fm)"}}>{pct}%</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Tabs */}
                <div className="tabrow">
                  {[["crm","CRM & Suivi"],["notes","Notes"],["documents",`Documents${(current.files||[]).length>0?" ("+current.files.length+")":""}`],["checklist",`Checklist${stageCL.length>0?" "+stagePct+"%":""}`],["activity","Activité"]].map(([id,lbl])=>(
                    <button key={id} className={`tbtn${tab===id?" active":""}`} onClick={()=>setTab(id)}>{lbl}</button>
                  ))}
                </div>

                <div className="scr">
                  {/* ── CRM ── */}
                  {tab==="crm" && <div className="ws">
                    <div className="crm-grid">
                      <div className="ccard">
                        <div className="ccard-title">Contact (vendeur / courtier)</div>
                        {[ ["name","Nom"],["phone","Téléphone"],["email","Email"],["company","Compagnie"],["role","Rôle"] ].map(([k,lbl])=>(
                          <div key={k} className="frow">
                            <div className="flbl">{lbl}</div>
                            <input value={current.contact?.[k]||""} onChange={e=>upd(current.id,d=>({...d,contact:{...d.contact,[k]:e.target.value}}))}/>
                          </div>
                        ))}
                      </div>
                      <div className="ccard">
                        <div className="ccard-title">Suivi & Priorité</div>
                        <div className="frow">
                          <div className="flbl">Priorité</div>
                          <div className="pri-btns">
                            {Object.entries(PRIORITY).map(([k,{label,color}])=>(
                              <button key={k} className="pri-btn"
                                style={current.priority===k?{background:color+"28",borderColor:color,color}:{}}
                                onClick={()=>upd(current.id,d=>({...d,priority:k}))}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="frow"><div className="flbl">Date de follow-up</div><input type="date" value={current.followUpDate||""} onChange={e=>upd(current.id,d=>({...d,followUpDate:e.target.value}))}/></div>
                        <div className="frow"><div className="flbl">Note de suivi</div><input value={current.followUpNote||""} onChange={e=>upd(current.id,d=>({...d,followUpNote:e.target.value}))} placeholder="Ex: Rappeler pour contre-offre…"/></div>
                        <div className="frow"><div className="flbl">Prochaine action</div><input value={current.nextAction||""} onChange={e=>upd(current.id,d=>({...d,nextAction:e.target.value}))} placeholder="Ex: Déposer l'offre d'achat"/></div>
                      </div>
                      <div className="ccard" style={{gridColumn:"1 / -1"}}>
                        <div className="ccard-title">Enregistrer une activité</div>
                        <ActivityLogger dealId={current.id} onLog={addAct}/>
                      </div>
                    </div>
                  </div>}

                  {/* ── Notes ── */}
                  {tab==="notes" && <div className="ws">
                    <div className="notes-grid">
                      {/* Notes deal */}
                      <div className="ccard">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                          <div className="ccard-title" style={{marginBottom:0}}>Notes sur le deal</div>
                          <button className={`ai-btn${aiLoadD?" loading":""}`} onClick={()=>aiSummarize("deal")}>
                            {aiLoadD?"⏳ Analyse…":"✦ Résumer avec IA"}
                          </button>
                        </div>
                        <textarea value={current.notesDeal||""} onChange={e=>upd(current.id,d=>({...d,notesDeal:e.target.value}))}
                          placeholder="Prix demandé, état général, potentiel, quartier, historique, stratégie…" style={{minHeight:190}}/>
                        {current.aiDeal && (
                          <div className="ai-box">
                            <div className="ai-box-lbl">✦ Résumé IA</div>
                            <div style={{whiteSpace:"pre-wrap"}}>{current.aiDeal}</div>
                            <button style={{marginTop:10,background:"transparent",border:"1px solid var(--br2)",color:"var(--t3)",borderRadius:"var(--rsm)",cursor:"pointer",fontFamily:"var(--fb)",padding:"3px 8px",fontSize:11}}
                              onClick={()=>upd(current.id,d=>({...d,aiDeal:""}))}>Effacer</button>
                          </div>
                        )}
                      </div>
                      {/* Notes vendeur */}
                      <div className="ccard">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                          <div className="ccard-title" style={{marginBottom:0}}>Notes sur le vendeur</div>
                          <button className={`ai-btn${aiLoadV?" loading":""}`} onClick={()=>aiSummarize("vendeur")}>
                            {aiLoadV?"⏳ Analyse…":"✦ Résumer avec IA"}
                          </button>
                        </div>
                        <textarea value={current.notesVendeur||""} onChange={e=>upd(current.id,d=>({...d,notesVendeur:e.target.value}))}
                          placeholder="Motivation du vendeur, délai, flexibilité prix, points sensibles, style de négociation…" style={{minHeight:190}}/>
                        {current.aiVendeur && (
                          <div className="ai-box">
                            <div className="ai-box-lbl">✦ Résumé IA</div>
                            <div style={{whiteSpace:"pre-wrap"}}>{current.aiVendeur}</div>
                            <button style={{marginTop:10,background:"transparent",border:"1px solid var(--br2)",color:"var(--t3)",borderRadius:"var(--rsm)",cursor:"pointer",fontFamily:"var(--fb)",padding:"3px 8px",fontSize:11}}
                              onClick={()=>upd(current.id,d=>({...d,aiVendeur:""}))}>Effacer</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>}

                  {/* ── Documents ── */}
                  {tab==="documents" && <div className="ws">
                    {/* PDF viewer */}
                    {viewing && (
                      <div className="pdf-viewer">
                        <div className="pdf-bar">
                          <div className="pdf-name">📄 {viewing.name}</div>
                          <div style={{display:"flex",gap:8,flexShrink:0}}>
                            <a href={viewing.dataUrl} download={viewing.name}><button className="btn btn-ghost btn-sm">⬇ Télécharger</button></a>
                            <button className="btn btn-ghost btn-sm" onClick={()=>setViewing(null)}>✕ Fermer</button>
                          </div>
                        </div>
                        {viewing.type?.includes("pdf")
                          ? <iframe src={viewing.dataUrl} className="pdf-frame" title={viewing.name}/>
                          : viewing.type?.includes("image")
                          ? <img src={viewing.dataUrl} alt={viewing.name} style={{maxWidth:"100%",maxHeight:500,objectFit:"contain",background:"#fff",display:"block",margin:"0 auto"}}/>
                          : <div style={{padding:24,textAlign:"center",color:"var(--t2)"}}>Prévisualisation non disponible. <a href={viewing.dataUrl} download={viewing.name} style={{color:"var(--acc)"}}>Télécharger le fichier</a></div>
                        }
                      </div>
                    )}

                    {/* Drop zone */}
                    <div className={`doc-drop${dragging?" drag":""}`}
                      onDragOver={e=>{e.preventDefault();setDragging(true)}}
                      onDragLeave={()=>setDragging(false)}
                      onDrop={e=>{e.preventDefault();setDragging(false);handleFiles(e.dataTransfer.files)}}
                      onClick={()=>fileRef.current?.click()}>
                      <div style={{fontSize:28,marginBottom:8,opacity:.5}}>📁</div>
                      <div style={{fontSize:13,color:"var(--t2)",marginBottom:4}}>Glissez vos fichiers ici ou cliquez pour sélectionner</div>
                      <div style={{fontSize:11,color:"var(--t3)"}}>PDF, images, Word, Excel — tous formats acceptés</div>
                      <input ref={fileRef} type="file" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
                    </div>

                    {(current.files||[]).length>0 && <>
                      <div className="sec-hd" style={{marginBottom:0}}><div className="sec-title" style={{fontSize:13}}>DOCUMENTS ({current.files.length})</div></div>
                      <div className="doc-grid">
                        {current.files.map(f => (
                          <div key={f.id} className="doc-card" onClick={()=>setViewing(f)}>
                            <div className="doc-icon">{fileIco(f.type)}</div>
                            <div className="doc-name" title={f.name}>{f.name}</div>
                            <div className="doc-meta">{fmtSz(f.size)} · {new Date(f.uploadedAt).toLocaleDateString("fr-CA")}</div>
                            <button className="doc-del" onClick={e=>{e.stopPropagation();delFile(f.id)}}>✕</button>
                          </div>
                        ))}
                      </div>
                    </>}
                    {(current.files||[]).length===0 && !viewing && <div style={{textAlign:"center",color:"var(--t3)",fontSize:12}}>Aucun document pour ce deal.</div>}
                  </div>}

                  {/* ── Checklist ── */}
                  {tab==="checklist" && <div className="ws">
                    <div className="ccard">
                      <div className="ccard-title">Checklist par étape</div>
                      <div className="cl-tabs">
                        {STAGES.map(s => {
                          const cl=current.checklists?.[s.id]||[];
                          const pct=cl.length?Math.round(cl.filter(i=>i.done).length/cl.length*100):null;
                          return (
                            <button key={s.id} className={`cl-tab${clStage===s.id?" active":""}`}
                              style={clStage===s.id?{background:s.color}:{}}
                              onClick={()=>{
                                setClStage(s.id);
                                if(!current.checklists?.[s.id]) upd(current.id,d=>({...d,checklists:{...d.checklists,[s.id]:buildCL(s.id)}}));
                              }}>
                              {s.label}{pct!==null&&<span style={{marginLeft:4,opacity:.7,fontSize:9,fontFamily:"var(--fm)"}}>{pct}%</span>}
                            </button>
                          );
                        })}
                      </div>
                      {activeCL.length>0 && <>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontSize:10,color:"var(--t3)"}}>{activeCL.filter(i=>i.done).length} / {activeCL.length}</span>
                          <span style={{fontSize:10,color:donePct===100?"var(--green)":"var(--acc)",fontFamily:"var(--fm)"}}>{donePct}%</span>
                        </div>
                        <div className="cl-progress"><div className="cl-bar" style={{width:`${donePct}%`}}/></div>
                      </>}
                      {activeCL.map(item => (
                        <div key={item.id} className="cl-item" onClick={()=>toggleCL(clStage,item.id)}>
                          <div className={`cl-box${item.done?" done":""}`}>{item.done&&<span style={{color:"#fff",fontSize:10}}>✓</span>}</div>
                          <span className={`cl-label${item.done?" done":""}`}>{item.label}</span>
                        </div>
                      ))}
                      <div style={{display:"flex",gap:8,marginTop:10}}>
                        <input value={clNew} onChange={e=>setClNew(e.target.value)} placeholder="Ajouter un item…"
                          onKeyDown={e=>{if(e.key==="Enter"&&clNew.trim()){upd(current.id,d=>({...d,checklists:{...d.checklists,[clStage]:[...(d.checklists?.[clStage]||[]),{id:`c_${Date.now()}`,label:clNew.trim(),done:false}]}}));setClNew("");}}}/>
                        <button className="btn btn-gold btn-sm" style={{flexShrink:0}}
                          onClick={()=>{if(clNew.trim()){upd(current.id,d=>({...d,checklists:{...d.checklists,[clStage]:[...(d.checklists?.[clStage]||[]),{id:`c_${Date.now()}`,label:clNew.trim(),done:false}]}}));setClNew("")}}}>Ajouter</button>
                      </div>
                    </div>
                  </div>}

                  {/* ── Activity ── */}
                  {tab==="activity" && <div className="ws">
                    <div className="ccard">
                      <div className="ccard-title">Enregistrer une activité</div>
                      <ActivityLogger dealId={current.id} onLog={addAct}/>
                    </div>
                    <div className="ccard">
                      <div className="ccard-title">Historique</div>
                      {(!current.activities||current.activities.length===0)
                        ? <div style={{fontSize:12,color:"var(--t3)",fontStyle:"italic"}}>Aucune activité encore.</div>
                        : current.activities.map(a=>(
                          <div key={a.id} className="act-item">
                            <div className="act-dot"/>
                            <div className="act-text" style={{flex:1}}>{a.text}</div>
                            <div className="act-time">{new Date(a.time).toLocaleString("fr-CA",{dateStyle:"short",timeStyle:"short"})}</div>
                          </div>
                        ))}
                    </div>
                  </div>}
                </div>
              </>
            }
          </>}
        </main>
      </div>

      {/* ── Modals ── */}
      {modal==="new" && (
        <div className="mo" onClick={()=>setModal(null)}>
          <div className="mo-box" onClick={e=>e.stopPropagation()}>
            <div className="mo-title">NOUVEAU DEAL</div>
            <div className="frow">
              <div className="flbl">Nom / Adresse de la propriété</div>
              <input autoFocus value={newTitle} onChange={e=>setNewTitle(e.target.value)}
                placeholder="Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu"
                onKeyDown={e=>e.key==="Enter"&&createDealFn()}/>
            </div>
            <div className="mo-foot">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Annuler</button>
              <button className="btn btn-gold" onClick={createDealFn}>Créer le deal</button>
            </div>
          </div>
        </div>
      )}

      {modal==="event" && (
        <div className="mo" onClick={()=>setModal(null)}>
          <div className="mo-box" onClick={e=>e.stopPropagation()}>
            <div className="mo-title">NOUVEL ÉVÉNEMENT</div>
            <div className="frow"><div className="flbl">Titre</div><input autoFocus value={newEv.title} onChange={e=>setNewEv(n=>({...n,title:e.target.value}))} placeholder="Ex: Inspection 320 rue Bouchard"/></div>
            <div className="frow"><div className="flbl">Date</div><input type="date" value={newEv.date} onChange={e=>setNewEv(n=>({...n,date:e.target.value}))}/></div>
            <div className="frow"><div className="flbl">Heure (optionnel)</div><input type="time" value={newEv.time} onChange={e=>setNewEv(n=>({...n,time:e.target.value}))}/></div>
            <div className="frow">
              <div className="flbl">Associer à un deal</div>
              <select value={newEv.dealId||currentId||""} onChange={e=>setNewEv(n=>({...n,dealId:e.target.value}))}>
                <option value="">— Sélectionner —</option>
                {deals.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div className="mo-foot">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Annuler</button>
              <button className="btn btn-gold" onClick={addEvent}>Créer</button>
            </div>
          </div>
        </div>
      )}

      {modal==="gcal" && (
        <div className="mo" onClick={()=>setModal(null)}>
          <div className="mo-box" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
            <div className="mo-title">🗓️ GOOGLE CALENDAR</div>
            <p style={{fontSize:13,color:"var(--t2)",lineHeight:1.7,marginBottom:12}}>
              Pour connecter Google Calendar à ton projet React, tu as besoin d'une clé OAuth 2.0 de Google Cloud Console :
            </p>
            <div className="code-block">{`1. console.cloud.google.com
   → Nouveau projet: "ACQUI-CRM"
   → Activer: Google Calendar API

2. Identifiants → OAuth 2.0
   → Type: Application Web
   → URI autorisé: http://localhost:3000

3. Dans ton .env.local:
   REACT_APP_GCAL_CLIENT_ID=ton_client_id

4. npm install @react-oauth/google`}</div>
            <p style={{fontSize:11,color:"var(--t3)",lineHeight:1.7}}>
              En attendant, tu peux créer des événements manuellement — ils s'affichent sur le calendrier et les follow-ups automatiquement.
            </p>
            <div className="mo-foot">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Fermer</button>
              <button className="btn btn-gold" onClick={()=>{setGcalOk(true);setModal(null);}}>Simuler la connexion ✓</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActivityLogger({ dealId, onLog }) {
  const [text, setText] = useState("");
  const QUICK = ["📞 Appel effectué","📧 Email envoyé","🤝 Rencontre faite","💰 Offre déposée","📋 Documents reçus","🔍 Inspection faite","🏦 Dossier financier soumis","✅ Condition levée"];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div className="qa-wrap">
        {QUICK.map(q=><button key={q} className="qa-btn" onClick={()=>onLog(dealId,q)}>{q}</button>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Note personnalisée…"
          onKeyDown={e=>{if(e.key==="Enter"&&text.trim()){onLog(dealId,text.trim());setText("");}}}/>
        <button className="btn btn-gold btn-sm" style={{flexShrink:0}}
          onClick={()=>{if(text.trim()){onLog(dealId,text.trim());setText("");}}}>Log</button>
      </div>
    </div>
  );
}
