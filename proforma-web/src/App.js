import { useState, useMemo, useCallback, useEffect, useRef, Suspense } from "react";
import lazyWithPreload from "./lib/lazyWithPreload.js";
import {
  mergePhoneLists,
  extractPhonesFromRow,
} from "./lib/phoneUtils.js";
import { STAGES, PRIORITY } from "./lib/stages.js";
import {
  fmtSz, fileIco, initials, calDays, dayKey,
  fmtCallDateTime, fmtDurationSeconds, MONTHS, DAYS,
} from "./lib/format.js";
import { load, isQuotaError, persist } from "./lib/storage.js";
import {
  buildCL, createDeal, dealLabel, normalizeDeal,
  buildLeadIdentityKey, getLeadPhones,
} from "./lib/dealHelpers.js";
import { migrateLeadsToOwners } from "./lib/ownerGrouping.js";

// ─── Runtime constants ───────────────────────────────────────────────────────
// OpenAI key for the in-app assistant chatbox. Client-side key — this ships in
// the bundle, so keep it in the admin-configured env when hosted. Left empty
// here so the repo doesn't leak a credential; Anthony fills it in locally.
const OPENAI_API_KEY = "";

// Hardcoded per-user PIN access. Client-side only (not a security boundary —
// anyone with devtools can bypass). Good enough for a small internal team
// where the real enforcement is "we trust each other" + role-gated UI.
const USERS = [
  { id: "anthony", name: "Anthony Makeen", role: "admin",    pin: "9472", initials: "AM", roleLabel: { fr: "Président",     en: "President" } },
  { id: "gaylord", name: "Gaylord",        role: "employee", pin: "3815", initials: "G",  roleLabel: { fr: "Acquisitions",  en: "Acquisitions" } },
];

// Tiny i18n dictionary. Deliberately narrow: covers the NEW strings this
// commit adds (auth, flag workflow, chatbox, top-level nav, topbar titles)
// plus a handful of high-traffic buttons. Deep-internal French strings
// (stage labels, workspace tabs, lead import wording) are left intact — a
// full-app translation pass is out of scope for this change.
//
// tr(lang, key, ...args) resolves the value; functions in the dict take
// runtime arguments (e.g. chat greeting with the user's name).
const I18N = {
  fr: {
    login_title: "Connexion SOCLE",
    login_tag: "Sélectionnez votre profil",
    login_pin_placeholder: "PIN à 4 chiffres",
    login_submit: "Entrer",
    login_error: "PIN incorrect.",
    logout: "Déconnexion",
    nav_dashboard: "Dashboard",
    nav_pipeline: "Pipeline",
    nav_map: "Carte",
    nav_followups: "Follow-ups",
    nav_calendar: "Calendrier",
    nav_owners: "Investisseurs",
    nav_leads: "Leads",
    nav_phonefinder: "Recherche Tél.",
    nav_new_deal: "＋ Nouveau deal",
    topbar_dashboard: "Dashboard",
    topbar_pipeline: "Pipeline",
    topbar_map: "Carte",
    topbar_map_sub: "Vue géographique des deals au Québec",
    topbar_followups: "Follow-ups",
    topbar_calendar: "Calendrier",
    topbar_owners: "Investisseurs",
    topbar_owners_sub: "Un investisseur = une adresse postale. Toutes ses compagnies, numéros et propriétés regroupés.",
    topbar_leads: "Leads",
    topbar_leads_sub: "Importez, enrichissez et gérez vos prospects propriétaires",
    topbar_workspace: "Workspace",
    topbar_workspace_empty: "Sélectionnez un deal",
    flag_banner: "🚩 Soumettre ce lead à Anthony",
    flag_note_placeholder: "Note pour Anthony (optionnel)…",
    flag_submit: "Soumettre",
    flag_submitted: "Lead soumis à Anthony.",
    flag_resubmit: "Déjà soumis · mettre à jour",
    admin_flags_title: "Leads soumis par Gaylord",
    admin_flags_empty: "Aucun lead soumis pour le moment.",
    admin_flags_note_label: "Note:",
    flag_view: "Voir",
    flag_dismiss: "✓ Vu",
    delete: "Supprimer",
    chat_title: "Assistant SOCLE",
    chat_send: "Envoyer",
    chat_placeholder: "Posez votre question…",
    chat_thinking: "Réflexion…",
    chat_key_missing: "⚠️ Clé OpenAI manquante. Ajoutez-la dans App.js (OPENAI_API_KEY).",
    chat_greet: (name) => `Bonjour ${name} ! Je suis l'assistant SOCLE. Posez-moi vos questions sur le CRM (stages, leads, follow-ups, calendrier, etc.) pour éviter de déranger Anthony.`,
    lang_switch: "EN",
  },
  en: {
    login_title: "SOCLE Sign-in",
    login_tag: "Choose your profile",
    login_pin_placeholder: "4-digit PIN",
    login_submit: "Enter",
    login_error: "Incorrect PIN.",
    logout: "Sign out",
    nav_dashboard: "Dashboard",
    nav_pipeline: "Pipeline",
    nav_map: "Map",
    nav_followups: "Follow-ups",
    nav_calendar: "Calendar",
    nav_owners: "Investors",
    nav_leads: "Leads",
    nav_phonefinder: "Phone Finder",
    nav_new_deal: "＋ New deal",
    topbar_dashboard: "Dashboard",
    topbar_pipeline: "Pipeline",
    topbar_map: "Map",
    topbar_map_sub: "Geographic view of deals across Québec",
    topbar_followups: "Follow-ups",
    topbar_calendar: "Calendar",
    topbar_owners: "Investors",
    topbar_owners_sub: "One investor = one mailing address. Companies, phone numbers and properties all grouped.",
    topbar_leads: "Leads",
    topbar_leads_sub: "Import, enrich, and manage owner prospects",
    topbar_workspace: "Workspace",
    topbar_workspace_empty: "Select a deal",
    flag_banner: "🚩 Submit this lead to Anthony",
    flag_note_placeholder: "Note for Anthony (optional)…",
    flag_submit: "Submit",
    flag_submitted: "Lead submitted to Anthony.",
    flag_resubmit: "Already submitted · update",
    admin_flags_title: "Leads submitted by Gaylord",
    admin_flags_empty: "No submitted leads.",
    admin_flags_note_label: "Note:",
    flag_view: "Open",
    flag_dismiss: "✓ Seen",
    delete: "Delete",
    chat_title: "SOCLE Assistant",
    chat_send: "Send",
    chat_placeholder: "Ask a question…",
    chat_thinking: "Thinking…",
    chat_key_missing: "⚠️ OpenAI key missing. Add it in App.js (OPENAI_API_KEY).",
    chat_greet: (name) => `Hi ${name}! I'm the SOCLE assistant. Ask me anything about the CRM (stages, leads, follow-ups, calendar, etc.) so you don't have to call Anthony.`,
    lang_switch: "FR",
  },
};

function tr(lang, key, ...args) {
  const val = (I18N[lang] && I18N[lang][key] !== undefined) ? I18N[lang][key] : I18N.fr[key];
  if (val === undefined) return key;
  return typeof val === "function" ? val(...args) : val;
}

import NavIcon from "./components/NavIcon.jsx";
import Topbar from "./components/Topbar.jsx";
import AddressAutocomplete from "./components/AddressAutocomplete.jsx";
import ActivityLogger from "./components/ActivityLogger.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
// Heavy pages/viewers — code-split with React.lazy so their deps
// (Leaflet via window.L, SheetJS via window.XLSX, react-window, and each
// page's local helpers) only load when the corresponding view/modal is
// actually opened. Suspense fallbacks below keep the initial paint snappy.
//
// lazyWithPreload exposes a .preload() method on each component so the
// nav bar can start fetching the chunk on hover/focus; by the time the
// user clicks, the chunk is usually already resolved and the Suspense
// fallback flashes for ~0ms instead of the 150–400ms a cold fetch takes.
const DealMap = lazyWithPreload(() => import("./components/DealMap.jsx"));
const XlsxViewer = lazyWithPreload(() => import("./components/XlsxViewer.jsx"));
const LeadsManager = lazyWithPreload(() => import("./pages/LeadsManager.jsx"));
const PhoneFinder = lazyWithPreload(() => import("./pages/PhoneFinder.jsx"));
const OwnersManager = lazyWithPreload(() => import("./pages/OwnersManager.jsx"));

// Map nav-item id → preload function. The nav button's onMouseEnter /
// onFocus calls this to kick off the chunk fetch. Entries without a
// lazy chunk (dashboard / pipeline / followups / calendar) are absent
// → prefetch becomes a no-op.
const NAV_PRELOAD = {
  map: DealMap.preload,
  leads: LeadsManager.preload,
  phonefinder: PhoneFinder.preload,
  owners: OwnersManager.preload,
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#F5F3EE;
  --sidebar:#FFFFFF;
  --card:#FFFFFF;
  --gold:#C9A84C;
  --gold-light:#F5EDD6;
  --text:#1A1A1A;
  --text2:#6B6B6B;
  --text3:#A0A0A0;
  --border:#E8E3D8;
  --green:#2D8C4E;
  --red:#C0392B;
  --blue:#2563EB;
  --radius:12px;
  --radius-sm:8px;
  --shadow:0 1px 4px rgba(0,0,0,0.06);
}
html,body,#root{height:100%}
body{font-family:'Plus Jakarta Sans',sans-serif;background:var(--bg);color:var(--text);overflow:hidden}
button,input,select,textarea{font-family:inherit}
a{color:inherit}

.app-shell{display:grid;grid-template-columns:260px 1fr;height:100vh;overflow:hidden}

/* Sidebar */
.sidebar{background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0}
.sb-head{padding:20px 16px 14px;border-bottom:1px solid var(--border)}
.sb-logo{font-size:22px;font-weight:700;letter-spacing:.6px;color:var(--gold);line-height:1}
.sb-logo-sub{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text2);margin-top:4px}
.sb-tag{font-size:11px;color:var(--text3);margin-top:4px}

.sb-nav{padding:10px 8px;border-bottom:1px solid var(--border)}
.nav-item{width:100%;border:none;background:transparent;display:flex;align-items:center;gap:9px;padding:10px 11px;border-radius:10px;color:var(--text2);font-size:13px;font-weight:600;cursor:pointer;position:relative;transition:all .15s}
.nav-item:hover{background:#FAF8F4;color:var(--text)}
.nav-item.active{background:var(--gold-light);color:var(--gold)}
.nav-item.active::before{content:'';position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:6px;background:var(--gold)}

.sb-sec{padding:10px 16px 8px;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--text3)}
.deal-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 8px 8px}
.deal-row{border:1px solid transparent;border-radius:10px;padding:9px;display:flex;gap:9px;cursor:pointer;transition:all .15s;margin-bottom:8px;background:transparent}
.deal-row:hover{background:#FAF8F4;border-color:var(--border)}
.deal-row.active{background:var(--gold-light);border-color:#E9D9AA}
.deal-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0}
.deal-main{min-width:0;flex:1}
.deal-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.deal-meta{display:flex;align-items:center;gap:6px;margin-top:4px}
.stage-pill-mini{font-size:9px;padding:2px 7px;border-radius:999px;font-weight:700;letter-spacing:.2px}

.new-btn{margin:10px 12px 12px;border:none;background:var(--gold);color:#fff;border-radius:10px;padding:11px 12px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:var(--shadow)}
.new-btn:hover{filter:brightness(1.04)}

.sb-profile{border-top:1px solid var(--border);padding:12px;display:flex;gap:10px;align-items:center}
.p-avatar{width:36px;height:36px;border-radius:50%;background:var(--gold-light);color:var(--gold);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.p-name{font-size:13px;font-weight:700;color:var(--text)}
.p-role{font-size:11px;color:var(--text3)}

/* Main */
.main{display:flex;flex-direction:column;min-width:0;overflow:hidden}
.topbar{background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;flex-shrink:0}
.tb-title{font-size:24px;font-weight:700;letter-spacing:.2px;color:var(--text)}
.tb-sub{margin-top:3px;font-size:12px;color:var(--text3)}
.tb-right{display:flex;align-items:center;gap:10px}
.tb-search{width:220px;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;outline:none}
.tb-search:focus{border-color:#D9C07A;box-shadow:0 0 0 3px #F5EDD6}
.bell{position:relative;width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:#fff;display:flex;align-items:center;justify-content:center;color:var(--text2)}
.bell-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:999px;background:var(--red);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px}
.tb-user{font-size:12px;font-weight:600;color:var(--text2)}

.content{flex:1;padding:22px;overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}

.btn{border:1px solid var(--border);background:#fff;color:var(--text2);padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer}
.btn:hover{background:#FAF8F4}
.btn-gold{border-color:transparent;background:var(--gold);color:#fff}
.btn-gold:hover{filter:brightness(1.05)}
.btn-danger{border:1px solid #F2C7BF;background:#FDF0ED;color:#A93425}
.btn-danger:hover{background:#FBE4E0}
.btn-sm{padding:6px 10px;font-size:11px}

/* Dashboard */
.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{padding:14px;display:flex;gap:10px;align-items:center}
.kpi-ico{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-body{min-width:0;flex:1}
.kpi-val{font-size:32px;line-height:1;font-weight:700;color:var(--text)}
.kpi-lbl{font-size:12px;font-weight:600;color:var(--text2);margin-top:2px}
.kpi-sub{font-size:11px;color:var(--green);margin-top:3px}

.grid-60-40{display:grid;grid-template-columns:3fr 2fr;gap:12px}
.grid-50{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.map-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.sec{padding:14px}
.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sec-title{font-size:14px;font-weight:700;color:var(--text)}

.pipe-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--border)}
.pipe-row:last-child{border-bottom:none}
.pipe-name{width:130px;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--text2)}
.pipe-bar-wrap{flex:1;height:8px;background:#F7F4ED;border-radius:999px;overflow:hidden}
.pipe-bar{height:100%;background:linear-gradient(90deg,var(--gold),#DDBF6E)}
.pipe-m{font-size:11px;color:var(--text2);font-weight:600;min-width:90px;text-align:right}

.activity-list{display:flex;flex-direction:column;gap:8px}
.act-row{display:flex;gap:9px;align-items:flex-start;padding:8px;border:1px solid var(--border);border-radius:10px;background:#fff}
.act-av{width:26px;height:26px;border-radius:50%;background:var(--gold-light);color:var(--gold);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.act-main{min-width:0;flex:1}
.act-text{font-size:12px;color:var(--text2);line-height:1.45}
.act-time{font-size:10px;color:var(--text3);margin-top:3px}

.task-list{display:flex;flex-direction:column;gap:8px}
.task{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer}
.task:hover{border-color:#DECFA7}
.task-main{min-width:0;flex:1}
.task-title{font-size:12px;font-weight:700;color:var(--text)}
.task-sub{font-size:11px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.date-badge{font-size:10px;padding:3px 8px;border-radius:999px;font-weight:700}

.opp-list{display:flex;flex-direction:column;gap:8px}
.opp{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer}
.opp:hover{border-color:#DECFA7}
.opp-l{min-width:0;flex:1}
.opp-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opp-sub{font-size:11px;color:var(--text2);margin-top:2px}
.badge-hot,.badge-warm,.badge-cold{font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px}
.badge-hot{background:#FCE9E6;color:var(--red)}
.badge-warm{background:#FFF3D8;color:#B7791F}
.badge-cold{background:#EAF1FF;color:var(--blue)}

/* Pipeline */
.kanban-wrap{overflow-x:auto;padding-bottom:3px}
.kanban{display:flex;gap:10px;min-width:max-content;align-items:flex-start}
.k-col{width:220px;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:10px;max-height:calc(100vh - 170px);overflow-y:auto}
.k-col{border-left:3px solid transparent}
.k-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.k-name{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700}
.k-count{font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--gold-light);color:var(--gold)}
.k-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;box-shadow:var(--shadow);margin-bottom:8px;cursor:pointer;transition:all .15s}
.k-card:hover{transform:translateY(-1px);box-shadow:0 8px 16px rgba(0,0,0,.09)}
.k-title{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-contact{margin-top:6px;display:flex;align-items:center;gap:7px}
.k-c-av{width:22px;height:22px;border-radius:50%;background:#F4EFE2;color:var(--gold);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.k-c-name{font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-price{font-size:12px;font-weight:700;color:var(--gold);margin-top:7px}
.k-row{display:flex;justify-content:space-between;margin-top:4px}
.k-mk{font-size:10px;color:var(--text3)}
.k-mv{font-size:10px;color:var(--text2);font-weight:600}
.k-foot{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.pr-hot,.pr-warm,.pr-cold{font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px}
.pr-hot{background:#FCE9E6;color:var(--red)}
.pr-warm{background:#FFF3D8;color:#B7791F}
.pr-cold{background:#EAF1FF;color:var(--blue)}
.k-progress{margin-top:7px;height:4px;background:#F2ECE0;border-radius:999px;overflow:hidden}
.k-bar{height:100%;background:var(--gold)}
.k-empty{font-size:11px;color:var(--text3);text-align:center;padding:12px 0;font-style:italic}

/* Workspace */
.ws-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ws-title{border:none;background:transparent;font-size:24px;font-weight:700;color:var(--text);width:100%;outline:none;padding:0}
.ws-title:focus{border-bottom:1px solid #DABF7F}
.ws-addr{font-size:12px;color:var(--text3);margin-top:4px}
.stage-crumb{font-size:11px;color:var(--text3)}

.stage-wrap{background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px;box-shadow:var(--shadow)}
.stage-track{display:flex;gap:8px;overflow-x:auto}
.stage-btn{border:1px solid var(--border);background:#fff;border-radius:999px;padding:7px 11px;font-size:11px;color:var(--text2);font-weight:700;cursor:pointer;white-space:nowrap}
.stage-btn.active{background:var(--gold-light);color:var(--gold);border-color:#E1CC94}

.tabs{display:flex;gap:18px;border-bottom:1px solid var(--border);padding:0 4px;background:transparent}
.tab{border:none;background:transparent;color:var(--text2);font-size:13px;font-weight:700;padding:11px 2px;cursor:pointer;border-bottom:2px solid transparent}
.tab.active{color:var(--gold);border-bottom-color:var(--gold)}

.ws-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.f-card{padding:15px}
.f-title{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text3);font-weight:700;margin-bottom:11px}
.f-row{display:flex;flex-direction:column;gap:4px;margin-bottom:9px}
.f-row:last-child{margin-bottom:0}
.f-lbl{font-size:11px;color:var(--text2);font-weight:600}
input,select,textarea{border:1px solid var(--border);background:#fff;color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px;width:100%;outline:none}
input:focus,select:focus,textarea:focus{border-color:#DABF7F;box-shadow:0 0 0 3px #F5EDD6}
textarea{resize:vertical;line-height:1.55;min-height:150px}

.contact-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.contact-avatar{width:42px;height:42px;border-radius:50%;background:var(--gold-light);color:var(--gold);display:flex;align-items:center;justify-content:center;font-weight:700}

.pri-row{display:flex;gap:6px}
.pri-btn{flex:1;border:1px solid var(--border);background:#fff;color:var(--text2);border-radius:8px;padding:7px;font-size:11px;font-weight:700;cursor:pointer}

.ai-btn{display:inline-flex;align-items:center;gap:5px;border:none;background:var(--gold-light);color:var(--gold);border-radius:999px;padding:5px 10px;font-size:10px;font-weight:700;cursor:pointer}
.ai-btn.loading{opacity:.6;pointer-events:none}
.ai-box{margin-top:10px;background:var(--gold-light);border:1px solid #E8D7AD;border-radius:10px;padding:12px;font-size:12px;color:#7D641E;line-height:1.6}
.ai-box-lbl{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px}

.doc-drop{border:1.5px dashed #D9C07A;border-radius:12px;background:#FCF8EE;padding:30px;text-align:center;cursor:pointer;transition:all .15s}
.doc-drop:hover,.doc-drop.drag{background:#F8F0DD}
.doc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}
.doc{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;box-shadow:var(--shadow);position:relative;cursor:pointer}
.doc-icon{font-size:28px;text-align:center;margin-bottom:8px}
.doc-name{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc-meta{font-size:10px;color:var(--text3);margin-top:3px}
.doc-del{position:absolute;top:6px;right:6px;border:1px solid #F2C7BF;background:#FDF0ED;color:#A93425;border-radius:5px;padding:2px 6px;font-size:9px;cursor:pointer;opacity:0;transition:opacity .12s}
.doc:hover .doc-del{opacity:1}
.doc-modal{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;background:var(--bg)}
.doc-modal-top{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border);background:#fff;flex-shrink:0}
.doc-modal-name{font-size:13px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:12px}
.doc-modal-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
.doc-modal-frame{width:100%;height:100%;border:none;background:#fff;flex:1}
.pf-wrap{overflow:auto;flex:1;background:#f7f4ef;padding:16px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.pf-panel{border:2px solid #5a4a32;border-radius:4px;overflow:hidden;flex-shrink:0;background:#fff;font-family:Arial,sans-serif;font-size:12px}
.pf-panel table{border-collapse:collapse;width:100%}
.pf-panel td{padding:4px 10px;vertical-align:middle;white-space:nowrap;color:#1a1000;border-bottom:1px solid #ece6d8;height:22px}
.pf-panel tr:hover td{background:#fef9ee!important}
.pf-panel td.ph{font-weight:700;background:#5a4a32!important;color:#fff!important;text-transform:uppercase;letter-spacing:.05em;font-size:11px;border-bottom:2px solid #3a2e1e}
.pf-panel td.psh{font-weight:700;background:#e8e0d0!important;color:#3a2e1e;font-size:11.5px;border-top:1px solid #aaa;border-bottom:1px solid #aaa}
.pf-panel td.pnum{text-align:right;font-variant-numeric:tabular-nums}
.pf-panel td.pbold{font-weight:700}
.pf-panel td.plbl{color:#5a4a32}
.pf-panel tr.pspacer td{height:8px;border-bottom:none;background:#f7f4ef!important}
.xlsx-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);background:#fff;flex-shrink:0;flex-wrap:wrap}

.cl-pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.cl-pill{border:1px solid var(--border);background:#fff;color:var(--text2);border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer}
.cl-pill.active{background:var(--gold-light);border-color:#E1CC94;color:var(--gold)}
.cl-progress{height:5px;background:#F0E8D8;border-radius:999px;overflow:hidden;margin-bottom:10px}
.cl-bar{height:100%;background:var(--gold);transition:width .2s}
.cl-item{display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer}
.cl-item:last-child{border-bottom:none}
.cl-box{width:16px;height:16px;border-radius:4px;border:1.5px solid #CAB98A;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cl-box.done{background:var(--gold);color:#fff;border-color:var(--gold)}
.cl-lbl{font-size:13px;color:var(--text)}
.cl-lbl.done{text-decoration:line-through;color:var(--text3)}

.timeline{display:flex;flex-direction:column}
.t-item{display:flex;gap:9px;padding:10px 0;border-bottom:1px solid var(--border)}
.t-item:last-child{border-bottom:none}
.t-dot{width:8px;height:8px;border-radius:50%;background:var(--gold);margin-top:5px;flex-shrink:0}
.t-text{font-size:12px;color:var(--text2);flex:1}
.t-time{font-size:10px;color:var(--text3);white-space:nowrap}
.qa-wrap{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.qa-btn{border:1px solid var(--border);background:#fff;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:700;color:var(--text2);cursor:pointer}

/* Calendar */
.cal-layout{display:grid;grid-template-columns:1fr 320px;gap:12px}
.cal-main{padding:14px}
.cal-side{padding:14px}
.cal-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cal-month{font-size:22px;font-weight:700;color:var(--text)}
.cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
.cal-dlbl{font-size:10px;color:var(--text3);text-align:center;padding:4px 0;font-weight:700;letter-spacing:.4px;text-transform:uppercase}
.cal-day{min-height:76px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:7px;cursor:pointer;transition:border-color .15s}
.cal-day:hover{border-color:#DABF7F}
.cal-day.today{border-color:#D4B767;background:#FFFBF1}
.cal-day.other{opacity:.45}
.cal-num{font-size:11px;color:var(--text2);font-weight:700;margin-bottom:4px}
.cal-event{font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-event.type-deal{background:#F5EDD6;color:#8B6C24}
.cal-event.type-followup{background:#FCE9E6;color:var(--red)}
.cal-event.type-google{background:#EAF1FF;color:var(--blue)}

/* Map */
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.map-layout{position:relative}
.map-wrap{position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff}
.map-viewport{width:100%;height:calc(100vh - 140px)}
.map-viewport.mini{height:280px}
.map-overlay{position:absolute;z-index:500;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow)}
.map-overlay.legend{left:12px;top:12px;padding:10px}
.map-overlay.filters{right:12px;top:12px;padding:8px}
.map-overlay h4{font-size:10px;letter-spacing:.8px;color:var(--text3);text-transform:uppercase;margin-bottom:6px}
.legend-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);margin-bottom:4px;white-space:nowrap}
.legend-row:last-child{margin-bottom:0}
.map-filter{min-width:170px}
.map-mini-foot{padding-top:10px;display:flex;justify-content:flex-end}
.map-pill{font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700}
.map-pin,.map-cluster-pin{
  width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);
}
.map-cluster-pin{
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;
}
.map-popup{min-width:200px;color:var(--text)}
.map-popup-title{font-size:13px;font-weight:700;margin-bottom:4px}
.map-popup-sub{font-size:11px;color:var(--text2);margin-bottom:6px}
.map-popup-row{font-size:11px;color:var(--text2);margin-bottom:4px}
.map-open-btn{
  margin-top:7px;border:none;background:var(--gold);color:#fff;border-radius:7px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;
}
.map-open-btn:hover{filter:brightness(1.04)}
.leaflet-popup-content-wrapper{border-radius:10px;border:1px solid var(--border);box-shadow:0 8px 16px rgba(0,0,0,0.12)}
.leaflet-popup-content{margin:10px}

/* Common */
.pill{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 20px;min-height:300px;text-align:center}
.empty-ico{font-size:44px;filter:drop-shadow(0 4px 10px #E5D4A5);animation:floaty 2.5s ease-in-out infinite}
.empty-title{font-size:20px;font-weight:700;color:var(--text)}
.empty-sub{font-size:12px;color:var(--text2);line-height:1.6;max-width:330px}

.mo{position:fixed;inset:0;background:rgba(245,243,238,.78);display:flex;align-items:center;justify-content:center;z-index:60}
.mo-box{width:460px;max-width:92vw;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 36px rgba(0,0,0,.12);padding:22px}
.mo-title{font-size:22px;font-weight:700;color:var(--text);margin-bottom:14px}
.mo-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}

.status-note{font-size:12px;color:var(--text2);padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:#fff}
.status-note.error{color:#A93425;background:#FDF0ED;border-color:#F2C7BF}
.call-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.call-log-wrap{margin-top:12px}
.call-log-list{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.call-log-item{border:1px solid var(--border);border-radius:10px;background:#fff;padding:10px}
.call-log-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.call-log-title{font-size:12px;font-weight:700;color:var(--text)}
.call-log-sub{font-size:11px;color:var(--text2);margin-top:2px}
.call-log-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.call-pill{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700}
.call-pill.success{background:#E9F7EF;color:var(--green)}
.call-pill.pending{background:#EAF1FF;color:var(--blue)}
.call-pill.failed{background:#FDF0ED;color:var(--red)}
.call-pill.neutral{background:#F4F1E8;color:#6B6B6B}
.call-transcript{margin-top:8px}
.call-transcript summary{cursor:pointer;font-size:11px;font-weight:700;color:var(--text2)}
.call-transcript-text{margin-top:6px;font-size:12px;line-height:1.55;color:var(--text2);background:#FAF8F4;border:1px solid var(--border);border-radius:8px;padding:9px;white-space:pre-wrap}

/* Phone Finder */
.pf-tbl{width:100%;border-collapse:collapse;font-size:12px}
.pf-tbl th{padding:9px 12px;text-align:left;font-weight:700;color:var(--text2);font-size:11px;letter-spacing:.3px;white-space:nowrap;border-bottom:1px solid var(--border);background:#F7F4EE}
.pf-tbl td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
.pf-tbl tbody tr:hover td{background:#FAF8F4}
.pf-tbl td.pf-input-col{max-width:180px}
.pf-tbl td.pf-match-col{max-width:200px}
.pf-tbl td.pf-web-col{max-width:160px}
.pf-cell-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pf-cell-addr{color:var(--text3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.pf-phone{font-weight:700;cursor:pointer;white-space:nowrap}
.pf-phone:hover{text-decoration:underline}
.pf-conf{display:inline-block;min-width:42px;text-align:center;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;font-variant-numeric:tabular-nums}
.pf-status{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
.pf-status.found{background:#E9F7EF;color:#1A7A3F}
.pf-status.needs_review{background:#FFF3D8;color:#B7791F}
.pf-status.multiple_matches{background:#FFF0E0;color:#C05A00}
.pf-status.not_found{background:#FDF0ED;color:#A93425}
.pf-conf.hi{background:#E9F7EF;color:#1A7A3F}
.pf-conf.mid{background:#FFF3D8;color:#B7791F}
.pf-conf.lo{background:#FFF0E0;color:#C05A00}
.pf-conf.zero{background:#FDF0ED;color:#A93425}
.pf-drop{border:1.5px dashed #D9C07A;border-radius:12px;background:#FCF8EE;padding:28px;text-align:center;cursor:pointer;transition:all .15s}
.pf-drop:hover{background:#F8F0DD}
.pf-cand{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;background:#fff;transition:border-color .15s}
.pf-cand:hover{border-color:#D9C07A;background:#FFFBF1}
.pf-cand.best{background:#FFFBF1;border-color:#E1CC94}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

@media (max-width:1280px){
  .kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid-60-40,.grid-50,.ws-grid,.cal-layout,.map-split{grid-template-columns:1fr}
  .doc-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:960px){
  .app-shell{grid-template-columns:1fr}
  .sidebar{display:none}
  .doc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`;

export default function App() {
  const stored = load();
  const [deals, setDeals]         = useState((stored?.deals || []).map(normalizeDeal));
  const [leads, setLeads]         = useState(Array.isArray(stored?.leads) ? stored.leads : []);
  const [owners, setOwners]       = useState(Array.isArray(stored?.owners) ? stored.owners : []);
  // Leads flagged by Gaylord for Anthony's review. Lives in the main persist
  // payload so it survives reloads.
  const [flaggedLeads, setFlaggedLeads] = useState(Array.isArray(stored?.flaggedLeads) ? stored.flaggedLeads : []);

  // Auth session — stored in its own localStorage key (not the main payload)
  // so signing out doesn't wipe CRM data. The session holds only id/name/role/
  // initials — the PIN stays out of anything persisted.
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("socle_user") || "null"); } catch { return null; }
  });

  // Language preference ("fr" | "en"), also stored in its own key.
  const [lang, setLang] = useState(() => {
    const v = localStorage.getItem("socle_lang");
    return v === "fr" || v === "en" ? v : "fr";
  });
  useEffect(() => { try { localStorage.setItem("socle_lang", lang); } catch {} }, [lang]);
  const t = useCallback((key, ...args) => tr(lang, key, ...args), [lang]);

  // Chat state (in-memory — conversation doesn't persist across reloads).
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatBusy, setChatBusy]         = useState(false);

  const isAdmin = currentUser?.role === "admin";

  const login = useCallback((userId, pin) => {
    const u = USERS.find(x => x.id === userId && x.pin === String(pin || ""));
    if (!u) return false;
    const session = { id: u.id, name: u.name, role: u.role, initials: u.initials, roleLabel: u.roleLabel };
    try { localStorage.setItem("socle_user", JSON.stringify(session)); } catch {}
    setCurrentUser(session);
    return true;
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem("socle_user"); } catch {}
    setCurrentUser(null);
    setChatOpen(false);
    setChatMessages([]);
  }, []);

  const [currentId, setCurrentId] = useState(stored?.currentId || null);
  const [gcalOk, setGcalOk]       = useState(stored?.gcalOk || false);
  const [gcalEvents, setGcalEvents] = useState([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalError, setGcalError] = useState("");
  const [view, setView]           = useState("dashboard");
  const [tab, setTab]             = useState("crm");
  const [modal, setModal]         = useState(null);
  const [newTitle, setNewTitle]   = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [clStage, setClStage]     = useState("prospection");
  const [clNew, setClNew]         = useState("");
  const [viewing, setViewing]     = useState(null);
  const [dragging, setDragging]   = useState(false);
  const [calDate, setCalDate]     = useState(new Date());
  const [mapStageFilter, setMapStageFilter] = useState("all");
  const [newEv, setNewEv]         = useState({ title:"", date:"", time:"", dealId:"" });
  const [aiLoadD, setAiLoadD]     = useState(false);
  const [aiLoadV, setAiLoadV]     = useState(false);
  const [callsByDeal, setCallsByDeal] = useState({});
  const [callsLoading, setCallsLoading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callNotice, setCallNotice] = useState({ type: "", text: "" });
  const fileRef = useRef();
  const geocodeTimersRef = useRef({});
  const geocodeSkipRef = useRef({});
  const [newAddrCoords, setNewAddrCoords] = useState(null);
  const [newUnits, setNewUnits] = useState("");
  const [newAskingPrice, setNewAskingPrice] = useState("");
  // App-level toast for persist/quota errors (rare but user-visible when it happens).
  const [appToast, setAppToast] = useState("");
  const persistTimerRef = useRef(null);

  // Debounce writes to localStorage: state changes during typing/drag were
  // triggering a full JSON.stringify of the whole CRM on every keystroke.
  // 500ms is a comfortable tradeoff — short enough that refreshes rarely
  // lose the latest edit, long enough to coalesce bursts of updates.
  useEffect(() => {
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persist({ deals, leads, owners, flaggedLeads, currentId, gcalOk }, (err) => {
        if (isQuotaError(err)) {
          setAppToast("⚠️ Stockage local plein. Exportez puis retirez des leads pour libérer de l'espace.");
          setTimeout(() => setAppToast(""), 8000);
        }
      });
    }, 500);
    return () => clearTimeout(persistTimerRef.current);
  }, [deals, leads, owners, flaggedLeads, currentId, gcalOk]);

  // Make sure a pending write is flushed before the tab closes.
  useEffect(() => {
    const flush = () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        persist({ deals, leads, owners, flaggedLeads, currentId, gcalOk });
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [deals, leads, owners, flaggedLeads, currentId, gcalOk]);

  // One-time migration: rebuild the Investisseurs view from legacy Leads.
  // Runs only when we have leads but no owners yet (fresh install of the
  // owner-primary model). Subsequent changes to `owners` happen through the
  // OwnersManager UI or during Phone Finder imports (see Task #4).
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    if (owners.length > 0) { migratedRef.current = true; return; }
    if (!Array.isArray(leads) || leads.length === 0) return;
    const migrated = migrateLeadsToOwners(leads);
    if (migrated.length > 0) {
      setOwners(migrated);
    }
    migratedRef.current = true;
  }, [leads, owners.length]);

  const current = useMemo(() => deals.find(d => d.id === currentId) || null, [deals, currentId]);
  const currentCalls = useMemo(() => {
    if (!current?.id) return [];
    return callsByDeal[current.id] || [];
  }, [callsByDeal, current?.id]);

  const upd = useCallback((id, fn) => {
    setDeals(p => p.map(d => d.id === id ? { ...fn(d), updatedAt: Date.now() } : d));
  }, []);

  const addAct = useCallback((id, text) => {
    upd(id, d => ({ ...d, activities: [{ id: Date.now(), text, time: Date.now() }, ...(d.activities || [])] }));
  }, [upd]);

  const loadCallsForDeal = useCallback(async (dealId, options = {}) => {
    if (!dealId) return;
    if (!options.silent) {
      setCallsLoading(true);
    }
    try {
      const response = await fetch(`/api/deals/${encodeURIComponent(dealId)}/calls`);
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Erreur ${response.status}`);
      }
      setCallsByDeal((prev) => ({ ...prev, [dealId]: data.calls || [] }));
    } catch (error) {
      if (!options.silent) {
        setCallNotice({ type: "error", text: error.message || "Impossible de charger l'historique des appels." });
      }
    } finally {
      if (!options.silent) {
        setCallsLoading(false);
      }
    }
  }, []);

  const startDealCall = useCallback(async () => {
    if (!current?.id) return;

    const contactPhone = String(current.contact?.phone || "").trim();
    if (!contactPhone) {
      setCallNotice({ type: "error", text: "Ajoutez un téléphone dans la fiche contact avant d'appeler." });
      return;
    }

    setCalling(true);
    setCallNotice({ type: "", text: "" });
    try {
      const response = await fetch("/api/twilio/calls/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dealId: current.id,
          dealTitle: current.title || "",
          contactName: String(current.contact?.name || "").trim(),
          contactPhone
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Erreur ${response.status}`);
      }

      addAct(current.id, `📞 Appel lancé vers ${current.contact?.name || contactPhone}`);
      setCallNotice({ type: "success", text: "Appel lancé. Le statut et l'enregistrement vont se mettre à jour automatiquement." });
      await loadCallsForDeal(current.id, { silent: true });
    } catch (error) {
      setCallNotice({ type: "error", text: error.message || "Impossible de lancer l'appel." });
    } finally {
      setCalling(false);
    }
  }, [addAct, current, loadCallsForDeal]);

  const retryCallTranscription = useCallback(async (callId) => {
    if (!callId || !current?.id) return;
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/transcribe/retry`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Erreur ${response.status}`);
      }
      setCallNotice({ type: "success", text: "Transcription relancée. Rafraîchissez dans quelques secondes." });
      await loadCallsForDeal(current.id, { silent: true });
    } catch (error) {
      setCallNotice({ type: "error", text: error.message || "Impossible de relancer la transcription." });
    }
  }, [current?.id, loadCallsForDeal]);

  useEffect(() => {
    if (!current?.id) return;
    setCallNotice({ type: "", text: "" });
    loadCallsForDeal(current.id);
  }, [current?.id, loadCallsForDeal]);

  const openDeal = useCallback((id) => {
    setCurrentId(id);
    setView("workspace");
    setTab("crm");
    setViewing(null);
  }, []);

  // ─── Flag-for-review workflow ──────────────────────────────────────────────
  // Employees (Gaylord) can tag a deal for Anthony's attention with an optional
  // note. Re-flagging the same deal replaces the prior entry (one pending flag
  // per deal — simpler than a full thread, good enough for the "take a look at
  // this" use case). Admin dismisses by removing the flag.
  const flagDeal = useCallback((dealId, note) => {
    if (!dealId || !currentUser) return;
    setFlaggedLeads(prev => {
      const without = prev.filter(f => f.dealId !== dealId);
      return [
        ...without,
        {
          id: `flag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          dealId,
          note: String(note || "").trim(),
          byId: currentUser.id,
          byName: currentUser.name,
          at: Date.now(),
        },
      ];
    });
  }, [currentUser]);

  const dismissFlag = useCallback((flagId) => {
    setFlaggedLeads(prev => prev.filter(f => f.id !== flagId));
  }, []);

  // ─── Chatbox → OpenAI gpt-4o-mini ─────────────────────────────────────────
  // Client-side call (key ships in bundle — see OPENAI_API_KEY note). The
  // system prompt sketches the CRM so the assistant can answer "what does
  // Pipeline mean?" / "où est-ce que je flag un lead?" without Gaylord calling
  // Anthony every ten minutes.
  const sendChat = useCallback(async (text) => {
    const content = String(text || "").trim();
    if (!content || chatBusy) return;
    const userMsg = { role: "user", content };
    const history = [...chatMessages.filter(m => m.role !== "system"), userMsg];
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    if (!OPENAI_API_KEY) {
      setChatMessages(prev => [...prev, { role: "assistant", content: t("chat_key_missing") }]);
      return;
    }
    setChatBusy(true);
    try {
      const sysPrompt = lang === "en" ? (
        `You are the SOCLE ACQUISITIONS assistant — an internal tool for a small Quebec real estate acquisitions team. ` +
        `Users: Anthony Makeen (admin, President) and Gaylord (employee, Acquisitions). ` +
        `The CRM has these main views (left sidebar): Dashboard, Pipeline, Map (Carte), Follow-ups, Calendar, Investors (Investisseurs — one mailing address = one person, all their companies and properties grouped), Leads (import/enrich), Phone Finder (admin only, uses Google Places). ` +
        `Deal stages: prospection → négociation → due diligence → closing → perdu. ` +
        `Employees can flag a deal for Anthony's review from the Workspace CRM tab (yellow banner "Submit this lead to Anthony"). Submitted flags appear on Anthony's dashboard. Employees cannot delete deals or run phone enrichment. The ✦ IA buttons summarize deal/vendor notes. There's a Google Calendar connection and Twilio-powered call recording per deal. ` +
        `The user talking to you right now is ${currentUser?.name || "a team member"} (${currentUser?.role || "member"}). Answer concisely in English. If they ask how to do something, describe the exact UI steps. If they ask something outside the CRM scope, politely redirect.`
      ) : (
        `Tu es l'assistant de SOCLE ACQUISITIONS, un CRM interne pour une petite équipe d'acquisition immobilière au Québec. ` +
        `Utilisateurs : Anthony Makeen (admin, Président) et Gaylord (employé, Acquisitions). ` +
        `Vues principales (barre de gauche) : Dashboard, Pipeline, Carte, Follow-ups, Calendrier, Investisseurs (une adresse postale = une personne, toutes ses compagnies et propriétés regroupées), Leads (importer/enrichir), Recherche Tél. (admin seulement, via Google Places). ` +
        `Étapes d'un deal : prospection → négociation → due diligence → closing → perdu. ` +
        `Les employés peuvent soumettre un lead à Anthony depuis l'onglet CRM du Workspace (bandeau jaune « Soumettre ce lead à Anthony »). Les leads soumis apparaissent sur le dashboard d'Anthony. Les employés ne peuvent pas supprimer de deals ni lancer la recherche téléphonique. Les boutons ✦ IA résument les notes du deal ou du vendeur. Il y a une connexion Google Calendar et un enregistrement d'appels Twilio par deal. ` +
        `L'utilisateur qui te parle est ${currentUser?.name || "un membre de l'équipe"} (${currentUser?.role || "membre"}). Réponds en français, de façon concise. Si on te demande comment faire une action, décris les étapes exactes dans l'UI. Si la question sort du cadre du CRM, redirige poliment.`
      );
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: sysPrompt }, ...history],
          temperature: 0.3,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setChatMessages(prev => [...prev, { role: "assistant", content: `❌ ${data.error?.message || `HTTP ${r.status}`}` }]);
        return;
      }
      const reply = data.choices?.[0]?.message?.content || "—";
      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `❌ ${err?.message || "Erreur réseau."}` }]);
    } finally {
      setChatBusy(false);
    }
  }, [chatMessages, chatBusy, lang, currentUser, t]);

  // Seed the chat with a greeting the first time it opens for a given user/lang.
  useEffect(() => {
    if (!chatOpen) return;
    if (chatMessages.length > 0) return;
    if (!currentUser) return;
    const firstName = String(currentUser.name || "").split(" ")[0];
    setChatMessages([{ role: "assistant", content: t("chat_greet", firstName) }]);
  }, [chatOpen, chatMessages.length, currentUser, t]);

  const createDealFn = () => {
    const d = createDeal(newTitle.trim() || "Nouveau deal", newAddress.trim(), newAddrCoords, newUnits.trim(), newAskingPrice.trim());
    setDeals(p => [d, ...p]);
    setCurrentId(d.id);
    setModal(null);
    setNewTitle("");
    setNewAddress("");
    setNewAddrCoords(null);
    setNewUnits("");
    setNewAskingPrice("");
    setView("workspace");
    setTab("crm");
  };

  const createDealFromLead = useCallback((lead) => {
    if (!lead) return null;
    const title = (lead.companyName || lead.contactName || lead.buildingAddress || "Lead importé").trim();
    const address = (lead.buildingAddress || lead.address || "").trim();
    const phones = getLeadPhones(lead);
    const nextDeal = {
      ...createDeal(title, address, null, "", ""),
      contact: {
        name: lead.contactName || "",
        phone: phones[0] || "",
        email: lead.email || "",
        company: lead.companyName || "",
        role: "Lead",
      },
      notesDeal: `${lead.notes || ""}${phones.length > 1 ? `\nAutres numéros: ${phones.slice(1).join(" · ")}` : ""}`.trim(),
      activities: [{ id: Date.now(), text: "Lead converti en deal", time: Date.now() }],
    };
    setDeals(prev => [nextDeal, ...prev]);
    setCurrentId(nextDeal.id);
    setView("workspace");
    setTab("crm");
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage: "converted", linkedDealId: nextDeal.id, updatedAt: Date.now() } : l));
    return nextDeal.id;
  }, []);

  const importPhoneFinderResultsToLeads = useCallback((rows, meta = {}) => {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const sourceTitle = String(meta?.title || "").trim();
    const sourceFile = sourceTitle ? `Recherche Tél. · ${sourceTitle}` : "Recherche Tél.";
    const now = Date.now();
    const current = (Array.isArray(leads) ? leads : []).map(lead => {
      const phones = getLeadPhones(lead);
      return { ...lead, phones, phone: phones[0] || "", updatedAt: lead.updatedAt || now };
    });
    const byKey = new Map();
    current.forEach(lead => {
      const key = buildLeadIdentityKey(lead);
      if (key && !byKey.has(key)) byKey.set(key, lead);
    });
    const additions = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const phones = mergePhoneLists(row?.phone, row?.inputPhones, extractPhonesFromRow(row?.rawRow));
      if (!phones.length) { skipped++; continue; }
      const companyName = String(row?.companyName || row?.inputName || row?.matchedName || "").trim();
      const contactName = String(row?.leadContact || "").trim();
      const buildingAddress = String(row?.buildingAddress || row?.inputAddress || row?.matchedAddress || "").trim();
      const key = buildLeadIdentityKey({ companyName, contactName, buildingAddress, inputName: row?.inputName, matchedName: row?.matchedName, inputAddress: row?.inputAddress, matchedAddress: row?.matchedAddress, phones });
      const createdAt = String(row?.searchedAt || new Date().toISOString());

      const existing = key ? byKey.get(key) : null;
      if (existing) {
        const merged = mergePhoneLists(existing.phones, phones);
        if (merged.length === existing.phones.length) { skipped++; continue; }
        existing.phones = merged;
        existing.phone = merged[0] || "";
        existing.updatedAt = now;
        if (!existing.companyName) existing.companyName = companyName;
        if (!existing.contactName) existing.contactName = contactName;
        if (!existing.buildingAddress) existing.buildingAddress = buildingAddress;
        if (!existing.website && row?.website) existing.website = String(row.website);
        if (!existing.matchedName && row?.matchedName) existing.matchedName = String(row.matchedName);
        if (!existing.matchedAddress && row?.matchedAddress) existing.matchedAddress = String(row.matchedAddress);
        if (!existing.sourceFile) existing.sourceFile = sourceFile;
        updated++;
        continue;
      }

      const rawRowForUnits = row?.rawRow || {};
      const rre = (patterns) => Object.entries(rawRowForUnits).find(([k]) => patterns.some(rx => rx.test(k)))?.[1] || "";
      const units       = parseInt(rre([/logement|unite|unit[eé]s?/i]), 10) || 0;
      const cityFromRow = rre([/\bville\d*\b/i]);
      const utilisation = row?.utilisation || rre([/utilisation|usage.*predominant|type.*immeuble/i]);
      const assessment  = rre([/valeur.*fonciere|valeur.*immeuble|[eé]valuation|valeur.*totale|assess/i]);
      const yearBuilt   = rre([/ann[eé]e.*construction|year.*built|construit/i]);
      const lotArea     = rre([/superficie.*terrain|superficie.*lot|lot.*area/i]);
      const nextLead = {
        id: `lead_pf_${now}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt,
        updatedAt: now,
        stage: "to_call",
        companyName,
        contactName,
        buildingAddress,
        city: cityFromRow,
        province: "",
        postalCode: "",
        country: "Canada",
        email: "",
        phone: phones[0] || "",
        phones,
        originalPhone: "",
        units,
        utilisation,
        assessment,
        yearBuilt,
        lotArea,
        notes: sourceTitle ? `Importé depuis Recherche Tél. (${sourceTitle})` : "Importé depuis Recherche Tél.",
        sourceFile,
        matchedName: String(row?.matchedName || ""),
        matchedAddress: String(row?.matchedAddress || ""),
        confidence: Number(row?.confidence || 0),
        lookupStatus: String(row?.status || "found"),
        website: String(row?.website || ""),
        linkedDealId: "",
      };
      additions.push(nextLead);
      if (key) byKey.set(key, nextLead);
      added++;
    }

    if (additions.length || updated > 0) {
      setLeads([...additions, ...current].slice(0, 6000));
    }

    return { added, updated, skipped };
  }, [leads]);

  const deleteDeal = (id) => {
    if (!window.confirm("Supprimer ce deal ?")) return;
    setDeals(p => p.filter(d => d.id !== id));
    setCallsByDeal((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
    upd(currentId, d => ({ ...d, checklists: { ...d.checklists, [sid]: (d.checklists?.[sid] || []).map(i => i.id === iid ? { ...i, done: !i.done } : i) } }));
  };

  const handleFiles = useCallback(async (list) => {
    if (!currentId || !list?.length) return;
    const arr = Array.from(list);
    const done = await Promise.all(arr.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = e => res({ id:`f_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name:f.name, type:f.type, size:f.size, dataUrl:e.target.result, uploadedAt:Date.now() });
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

  const geocodeAddress = useCallback(async (address) => {
    const q = encodeURIComponent(address);
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${q}&lat=45.5088&lon=-73.5878&limit=1&lang=fr`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const f = data?.features?.[0];
      if (!f) return null;
      const [lng, lat] = f.geometry?.coordinates || [];
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
      return { lat: Number(lat), lng: Number(lng) };
    } catch {
      return null;
    }
  }, []);


  useEffect(() => {
    deals.forEach((deal) => {
      const address = (deal.address || "").trim();
      if (!address || deal.coords) return;
      if (geocodeSkipRef.current[deal.id] === address) return;
      if (geocodeTimersRef.current[deal.id]) return;

      geocodeTimersRef.current[deal.id] = setTimeout(async () => {
        delete geocodeTimersRef.current[deal.id];
        try {
          const coords = await geocodeAddress(address);
          if (!coords) {
            geocodeSkipRef.current[deal.id] = address;
            return;
          }
          setDeals((prev) => prev.map((d) => {
            if (d.id !== deal.id) return d;
            if ((d.address || "").trim() !== address) return d;
            return { ...d, coords, updatedAt: Date.now() };
          }));
        } catch {
          geocodeSkipRef.current[deal.id] = address;
        }
      }, 1000);
    });

    Object.keys(geocodeTimersRef.current).forEach((id) => {
      const deal = deals.find((d) => d.id === id);
      const shouldKeep = !!deal && !!(deal.address || "").trim() && !deal.coords;
      if (!shouldKeep) {
        clearTimeout(geocodeTimersRef.current[id]);
        delete geocodeTimersRef.current[id];
      }
    });
  }, [deals, geocodeAddress]);

  useEffect(() => {
    return () => {
      Object.values(geocodeTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const aiSummarize = async (type) => {
    if (!current) return;
    const text = type === "deal" ? current.notesDeal : current.notesVendeur;
    if (!text?.trim()) { alert("Ajoutez des notes avant de formater."); return; }
    type === "deal" ? setAiLoadD(true) : setAiLoadV(true);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type === "deal" ? "deal" : "vendeur", text })
      });
      const data = await res.json();
      const summary = data.ok ? data.summary : (data.error || "Erreur API.");
      upd(current.id, d => ({ ...d, [type==="deal"?"aiDeal":"aiVendeur"]: summary }));
    } catch {
      upd(current.id, d => ({ ...d, [type==="deal"?"aiDeal":"aiVendeur"]: "Erreur de connexion au serveur." }));
    } finally {
      type === "deal" ? setAiLoadD(false) : setAiLoadV(false);
    }
  };

  const connectGoogleCalendar = useCallback(() => {
    const clientId = process.env.REACT_APP_GCAL_CLIENT_ID;
    if (!clientId) { setGcalError("REACT_APP_GCAL_CLIENT_ID manquant."); return; }
    if (!window.google?.accounts?.oauth2) { setGcalError("Google OAuth non chargé. Rafraîchissez la page."); return; }

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
          const query = new URLSearchParams({ maxResults: "20", orderBy: "startTime", singleEvents: "true", timeMin });
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
              time: event.start.dateTime ? event.start.dateTime.split("T")[1].slice(0,5) : "",
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

    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(newEv.date)
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
    const weekAgo = Date.now() - 7 * 86400000;
    return {
      total: deals.length,
      active: deals.filter(d => d.stage !== "perdu").length,
      overdue: deals.filter(d => d.followUpDate && new Date(d.followUpDate) < today).length,
      closing: deals.filter(d => d.stage === "closing").length,
      weekAdds: deals.filter(d => d.createdAt >= weekAgo).length,
      prospection: deals.filter(d => d.stage === "prospection").length,
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
    deals.forEach(d => { const k = d.stage || "prospection"; (m[k] || m.prospection).push(d); });
    return m;
  }, [deals]);

  const activityFeed = useMemo(() => {
    return deals.flatMap(d => (d.activities || []).map(a => ({ ...a, dealTitle: d.title })))
      .sort((a,b) => b.time - a.time)
      .slice(0, 8);
  }, [deals]);

  const topOpps = useMemo(() => {
    const scored = deals
      .filter(d => d.stage !== "perdu")
      .map(d => ({ ...d, score: (PRIORITY[d.priority || "medium"]?.score || 1) + (d.stage === "closing" ? 1.5 : d.stage === "financement" ? 1 : 0.5) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 3);
    return scored;
  }, [deals]);

  const geocodedDeals = useMemo(() => deals.filter((d) => d.coords?.lat && d.coords?.lng), [deals]);
  const filteredMapDeals = useMemo(() => {
    if (mapStageFilter === "all") return geocodedDeals;
    return geocodedDeals.filter((d) => d.stage === mapStageFilter);
  }, [geocodedDeals, mapStageFilter]);

  const todayStr = new Date().toISOString().split("T")[0];
  const y = calDate.getFullYear();
  const mo = calDate.getMonth();
  const days = calDays(y, mo);

  const activeCL = current?.checklists?.[clStage] || [];
  const donePct = activeCL.length ? Math.round(activeCL.filter(i=>i.done).length/activeCL.length*100) : 0;
  const stageCL = current?.checklists?.[current?.stage] || [];
  const stagePct = stageCL.length ? Math.round(stageCL.filter(i=>i.done).length/stageCL.length*100) : 0;

  const currentStageLabel = STAGES.find(s => s.id === current?.stage)?.label || "—";

  // Admin sees the combined count of overdue follow-ups + submitted flags in
  // the topbar bell; employees keep the original overdue-only count.
  const bellCount = currentUser?.role === "admin"
    ? (stats.overdue + flaggedLeads.length)
    : stats.overdue;

  // Common props for the <Topbar> — keeps the nine call sites DRY.
  const topbarCommon = currentUser ? {
    userName: currentUser.name,
    badgeCount: bellCount,
    lang,
    onToggleLang: () => setLang(lang === "fr" ? "en" : "fr"),
    langSwitchLabel: t("lang_switch"),
  } : {};

  // Gate the app behind a PIN login. Session lives in localStorage so a
  // refresh doesn't kick the user back to the login screen.
  if (!currentUser) {
    return (
      <>
        <style>{CSS}</style>
        <LoginScreen users={USERS} onLogin={login} lang={lang} setLang={setLang} t={t} />
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sb-head">
            <div className="sb-logo">SOCLE</div>
            <div className="sb-logo-sub">ACQUISITIONS</div>
            <div className="sb-tag">Investissement Immobilier</div>
          </div>

          <div className="sb-nav">
            {[
              { id:"dashboard", label:t("nav_dashboard") },
              { id:"pipeline", label:t("nav_pipeline") },
              { id:"map", label:t("nav_map") },
              { id:"followups", label:t("nav_followups") },
              { id:"calendar", label:t("nav_calendar") },
              { id:"owners", label:t("nav_owners") },
              { id:"leads", label:t("nav_leads") },
              // Phone Finder is admin-only: Gaylord doesn't get it in the nav.
              ...(isAdmin ? [{ id:"phonefinder", label:t("nav_phonefinder") }] : []),
            ].map(item => (
              <button
                key={item.id}
                className={`nav-item${view===item.id?" active":""}`}
                onClick={() => setView(item.id)}
                onMouseEnter={NAV_PRELOAD[item.id]}
                onFocus={NAV_PRELOAD[item.id]}
              >
                <NavIcon id={item.id} />
                <span style={{flex:1,textAlign:"left"}}>{item.label}</span>
                {item.id === "followups" && stats.overdue > 0 && <span className="k-count" style={{background:"#FCE9E6",color:"#C0392B"}}>{stats.overdue}</span>}
              </button>
            ))}
          </div>

          <div className="sb-sec">Deals récents</div>
          <div className="deal-scroll">
            {deals.length===0 && <div className="status-note">Aucun deal encore.</div>}
            {deals.slice(0, 30).map(d => {
              const st = STAGES.find(s => s.id === d.stage) || STAGES[0];
              return (
                <div key={d.id} className={`deal-row${d.id===currentId && view==="workspace"?" active":""}`} onClick={() => openDeal(d.id)}>
                  <div className="deal-avatar" style={{background:st.color}}>{initials(d.title, "DL")}</div>
                  <div className="deal-main">
                    <div className="deal-title">{dealLabel(d)}</div>
                    <div className="deal-meta">
                      <span className="stage-pill-mini" style={{background:st.color+"22",color:st.color}}>{st.label}</span>
                      <span style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.contact?.name || "Sans contact"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="new-btn" onClick={() => setModal("new")}>{t("nav_new_deal")}</button>

          <div className="sb-profile">
            <div className="p-avatar">{currentUser.initials || "?"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="p-name">{currentUser.name}</div>
              <div className="p-role">
                {(currentUser.roleLabel && currentUser.roleLabel[lang]) || currentUser.role}
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              title={t("logout")}
              aria-label={t("logout")}
              style={{
                border: "1px solid var(--border)",
                background: "#fff",
                color: "var(--text2)",
                borderRadius: 8,
                width: 30, height: 30,
                display: "grid", placeItems: "center",
                fontSize: 14, cursor: "pointer",
                flexShrink: 0,
              }}
            >↩</button>
          </div>
        </aside>

        <main className="main">
          {view === "dashboard" && (
            <>
              <Topbar title={t("topbar_dashboard")} {...topbarCommon} />
              <div className="content">
                {isAdmin && flaggedLeads.length > 0 && (
                  <div
                    className="card sec"
                    style={{
                      background: "linear-gradient(135deg, #FFF8E1 0%, #FAF0C8 100%)",
                      border: "1px solid #E8D79A",
                      marginBottom: 16,
                    }}
                  >
                    <div className="sec-head">
                      <div className="sec-title" style={{color: "#8D6A15"}}>
                        🚩 {t("admin_flags_title")} ({flaggedLeads.length})
                      </div>
                    </div>
                    <div style={{display: "flex", flexDirection: "column", gap: 8}}>
                      {flaggedLeads
                        .slice()
                        .sort((a, b) => (b.at || 0) - (a.at || 0))
                        .map(f => {
                          const d = deals.find(x => x.id === f.dealId);
                          return (
                            <div
                              key={f.id}
                              style={{
                                background: "#fff",
                                border: "1px solid #E8D79A",
                                borderRadius: 10,
                                padding: "10px 12px",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                flexWrap: "wrap",
                              }}
                            >
                              <div style={{flex: 1, minWidth: 200}}>
                                <div style={{fontSize: 13, fontWeight: 700, color: "var(--text)"}}>
                                  {d ? dealLabel(d) : f.dealId}
                                </div>
                                <div style={{fontSize: 11, color: "var(--text3)", marginTop: 2}}>
                                  {f.byName} · {new Date(f.at).toLocaleString(lang === "en" ? "en-CA" : "fr-CA", {dateStyle: "short", timeStyle: "short"})}
                                </div>
                                {f.note && (
                                  <div style={{fontSize: 12, color: "var(--text2)", marginTop: 6}}>
                                    <span style={{fontWeight: 700}}>{t("admin_flags_note_label")}</span> {f.note}
                                  </div>
                                )}
                              </div>
                              <div style={{display: "flex", gap: 6}}>
                                {d && (
                                  <button
                                    className="btn btn-sm"
                                    onClick={() => openDeal(f.dealId)}
                                  >
                                    {t("flag_view")}
                                  </button>
                                )}
                                <button
                                  className="btn btn-sm"
                                  onClick={() => dismissFlag(f.id)}
                                >
                                  {t("flag_dismiss")}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
                <div className="kpi-grid">
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#F5EDD6",color:"#8D742D"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.total}</div><div className="kpi-lbl">Deals Total</div><div className="kpi-sub">+{stats.weekAdds} cette semaine</div></div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#EAF1FF",color:"#2563EB"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 12l3 3 5-5"/><path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.closing}</div><div className="kpi-lbl">En Closing</div><div className="kpi-sub">Progression solide</div></div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#FCE9E6",color:"#C0392B"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.overdue}</div><div className="kpi-lbl">Follow-ups Retard</div><div className="kpi-sub" style={{color:stats.overdue>0?"var(--red)":"var(--green)"}}>{stats.overdue>0?"Action requise":"Sous contrôle"}</div></div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-ico" style={{background:"#EEF9F2",color:"#2D8C4E"}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>
                    <div className="kpi-body"><div className="kpi-val">{stats.prospection}</div><div className="kpi-lbl">En Prospection</div><div className="kpi-sub">Flux actif</div></div>
                  </div>
                </div>

                <div className="grid-60-40">
                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">Pipeline des Acquisitions</div><button className="btn btn-sm" onClick={() => setView("pipeline")}>Vue complète</button></div>
                    <div className="map-split">
                      <div>
                        {STAGES.filter(s=>s.id!=="perdu").map(s => {
                          const count = pipeline[s.id]?.length || 0;
                          const pct = deals.length ? Math.round((count / deals.length) * 100) : 0;
                          const value = (count * 1.35).toFixed(1);
                          return (
                            <div key={s.id} className="pipe-row">
                              <div className="pipe-name"><div className="dot" style={{background:s.color}}/>{s.label}</div>
                              <div className="pipe-bar-wrap"><div className="pipe-bar" style={{width:`${Math.max(pct,4)}%`}}/></div>
                              <div className="pipe-m">{count} | ${value}M</div>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        <div className="map-wrap">
                          <ErrorBoundary label="la carte">
                            <Suspense fallback={<div style={{height:280,display:"grid",placeItems:"center",color:"var(--text2)",fontSize:12}}>Chargement de la carte…</div>}>
                              <DealMap deals={geocodedDeals} onOpenDeal={openDeal} interactive={false} height={280} />
                            </Suspense>
                          </ErrorBoundary>
                        </div>
                        <div className="map-mini-foot">
                          <button className="btn btn-sm" onClick={() => setView("map")}>Voir la carte complète</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">Activité Récente</div></div>
                    <div className="activity-list">
                      {activityFeed.length===0 ? <div className="status-note">Aucune activité encore.</div> : activityFeed.map(a => (
                        <div key={a.id} className="act-row">
                          <div className="act-av">AM</div>
                          <div className="act-main">
                            <div className="act-text"><strong>{a.dealTitle}</strong> · {a.text}</div>
                            <div className="act-time">{new Date(a.time).toLocaleString("fr-CA",{dateStyle:"short",timeStyle:"short"})}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid-50">
                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">Tâches à Compléter</div><button className="btn btn-sm" onClick={() => setView("followups")}>Voir tout</button></div>
                    <div className="task-list">
                      {followUps.slice(0,6).map(d => {
                        const isOD = d.diff < 0;
                        const isToday = d.diff === 0;
                        return (
                          <div key={d.id} className="task" onClick={() => openDeal(d.id)}>
                            <div className="task-main">
                              <div className="task-title">{dealLabel(d)}</div>
                              <div className="task-sub">{d.followUpNote || "Suivi à compléter"}</div>
                            </div>
                            <span className="date-badge" style={{background:isOD?"#FCE9E6":isToday?"#F5EDD6":"#F4F1E8",color:isOD?"#C0392B":isToday?"#9B7A2A":"#6B6B6B"}}>
                              {isOD?`${Math.abs(d.diff)}j retard`:isToday?"Aujourd'hui":`Dans ${d.diff}j`}
                            </span>
                          </div>
                        );
                      })}
                      {followUps.length===0 && <div className="status-note">Aucun follow-up planifié.</div>}
                    </div>
                  </div>

                  <div className="card sec">
                    <div className="sec-head"><div className="sec-title">Top Opportunités</div></div>
                    <div className="opp-list">
                      {topOpps.map(d => {
                        const pr = PRIORITY[d.priority || "medium"];
                        return (
                          <div key={d.id} className="opp" onClick={() => openDeal(d.id)}>
                            <div className="opp-l">
                              <div className="opp-title">{dealLabel(d)}</div>
                              <div className="opp-sub">{STAGES.find(s=>s.id===d.stage)?.label || "Prospection"}</div>
                            </div>
                            <span className={pr.cls}>{pr.tag}</span>
                          </div>
                        );
                      })}
                      {topOpps.length===0 && <div className="status-note">Ajoutez des deals pour voir les opportunités.</div>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "pipeline" && (
            <>
              <Topbar title={t("topbar_pipeline")} {...topbarCommon} />
              <div className="content">
                <div className="kanban-wrap">
                  <div className="kanban">
                    {STAGES.map(s => {
                      const col = pipeline[s.id] || [];
                      return (
                        <div key={s.id} className="k-col" style={{borderLeftColor:s.color}}>
                          <div className="k-hd">
                            <div className="k-name"><div className="dot" style={{background:s.color}}/>{s.label}</div>
                            <span className="k-count">{col.length}</span>
                          </div>
                          {col.length===0 && <div className="k-empty">Aucun deal</div>}
                          {col.map(d => {
                            const today = new Date(); today.setHours(0,0,0,0);
                            const diff = d.followUpDate ? Math.ceil((new Date(d.followUpDate)-today)/86400000) : null;
                            const isOD = d.followUpDate && new Date(d.followUpDate) < today;
                            const cl = d.checklists?.[d.stage] || [];
                            const clPct = cl.length ? Math.round(cl.filter(i=>i.done).length/cl.length*100) : 0;
                            const pr = PRIORITY[d.priority || "medium"];
                            return (
                              <div key={d.id} className="k-card" onClick={() => openDeal(d.id)}>
                                <div className="k-title">{dealLabel(d)}</div>
                                <div className="k-contact"><div className="k-c-av">{initials(d.contact?.name, "CT")}</div><span className="k-c-name">{d.contact?.name || "Contact à définir"}</span></div>
                                <div className="k-price">{d.askingPrice ? `${Number(d.askingPrice).toLocaleString("en-CA")} $` : "Prix: À valider"}</div>
                                {d.followUpDate && <div className="k-row"><span className="k-mk">Suivi</span><span className="k-mv" style={{color:isOD?"var(--red)":"var(--text2)"}}>{isOD?`⚠ ${Math.abs(diff)}j`:d.followUpDate}</span></div>}
                                <div className="k-row"><span className="k-mk">Documents</span><span className="k-mv">{(d.files||[]).length}</span></div>
                                <div className="k-progress"><div className="k-bar" style={{width:`${clPct}%`}}/></div>
                                <div className="k-foot">
                                  <span className={pr.cls}>{pr.tag}</span>
                                  <span className="pill" style={{background:"#F4F1E8",color:"#8A7A4D"}}>Checklist {clPct}%</span>
                                  <span className="pill" style={{background:"#F4F1E8",color:"#8A7A4D"}}>📎 {(d.files||[]).length}</span>
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

          {view === "map" && (
            <>
              <Topbar title={t("topbar_map")} subtitle={t("topbar_map_sub")} {...topbarCommon} />
              <div className="content">
                <div className="map-layout">
                  <div className="map-wrap">
                    <ErrorBoundary label="la carte">
                      <Suspense fallback={<div style={{height:"calc(100vh - 140px)",display:"grid",placeItems:"center",color:"var(--text2)",fontSize:13}}>Chargement de la carte…</div>}>
                        <DealMap deals={filteredMapDeals} onOpenDeal={openDeal} interactive height={"calc(100vh - 140px)"} />
                      </Suspense>
                    </ErrorBoundary>
                    <div className="map-overlay legend">
                      <h4>Étapes</h4>
                      {STAGES.map((stage) => (
                        <div key={stage.id} className="legend-row">
                          <span className="dot" style={{background:stage.color}} />
                          <span>{stage.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="map-overlay filters">
                      <div className="map-filter">
                        <div style={{fontSize:10,letterSpacing:".7px",textTransform:"uppercase",color:"var(--text3)",fontWeight:700,marginBottom:5}}>Filtrer</div>
                        <select value={mapStageFilter} onChange={(e) => setMapStageFilter(e.target.value)}>
                          <option value="all">Toutes les étapes</option>
                          {STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="status-note">
                  {filteredMapDeals.length > 0
                    ? `${filteredMapDeals.length} deal(s) affiché(s) sur la carte.`
                    : "Aucun deal géocodé pour ce filtre. Ajoutez une adresse dans CRM & Suivi pour afficher un pin."}
                </div>
              </div>
            </>
          )}

          {view === "followups" && (
            <>
              <Topbar title={t("topbar_followups")} {...topbarCommon} />
              <div className="content">
                {followUps.length===0 ? (
                  <div className="card empty">
                    <div className="empty-ico">📅</div>
                    <div className="empty-title">Aucun Follow-up</div>
                    <div className="empty-sub">Ajoutez une date de suivi dans l'onglet CRM d'un deal.</div>
                  </div>
                ) : (
                  <div className="card sec">
                    <div className="task-list">
                      {followUps.map(d => {
                        const st = STAGES.find(s=>s.id===d.stage) || STAGES[0];
                        const isOD = d.diff < 0;
                        const isToday = d.diff === 0;
                        return (
                          <div key={d.id} className="task" onClick={() => openDeal(d.id)}>
                            <div className="task-main">
                              <div className="task-title">{dealLabel(d)}</div>
                              <div className="task-sub">{d.followUpNote || "Suivi requis"}{d.contact?.name ? ` · ${d.contact.name}` : ""}</div>
                            </div>
                            <span className="pill" style={{background:st.color+"22",color:st.color}}>{st.label}</span>
                            <span className="date-badge" style={{background:isOD?"#FCE9E6":isToday?"#F5EDD6":"#F4F1E8",color:isOD?"#C0392B":isToday?"#9B7A2A":"#6B6B6B"}}>
                              {isOD?`${Math.abs(d.diff)}j retard`:isToday?"Aujourd'hui":`Dans ${d.diff}j`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {view === "calendar" && (
            <>
              <Topbar title={t("topbar_calendar")} {...topbarCommon} />
              <div className="content">
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <button className="btn btn-gold" onClick={connectGoogleCalendar} disabled={gcalLoading}>{gcalLoading?"Connexion...":gcalOk?"Actualiser Google Calendar":"Connecter Google Calendar"}</button>
                  {gcalOk && !gcalLoading && <span className="status-note">Google Calendar connecté</span>}
                  <button className="btn" onClick={() => setModal("event")}>＋ Événement</button>
                </div>
                {gcalLoading && <div className="status-note">Chargement des événements Google Calendar…</div>}
                {gcalError && <div className="status-note error">{gcalError}</div>}

                <div className="cal-layout">
                  <div className="card cal-main">
                    <div className="cal-hd">
                      <button className="btn btn-sm" onClick={() => setCalDate(new Date(y, mo-1, 1))}>‹</button>
                      <div className="cal-month">{MONTHS[mo]} {y}</div>
                      <button className="btn btn-sm" onClick={() => setCalDate(new Date(y, mo+1, 1))}>›</button>
                    </div>
                    <div className="cal-grid">
                      {DAYS.map(d => <div key={d} className="cal-dlbl">{d}</div>)}
                      {days.map((d,i) => {
                        const k = dayKey(d);
                        const evs = allEvents.filter(e => e.date === k);
                        return (
                          <div key={i} className={`cal-day${k===todayStr?" today":""}${d.other?" other":""}`} onClick={() => { setNewEv(n => ({ ...n, date:k })); setModal("event"); }}>
                            <div className="cal-num">{d.d}</div>
                            {evs.slice(0,2).map(ev => <div key={ev.id} className={`cal-event type-${ev.type}`} title={ev.title}>{ev.title}</div>)}
                            {evs.length>2 && <div style={{fontSize:9,color:"var(--text3)"}}>+{evs.length-2}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="card cal-side">
                    <div className="sec-head"><div className="sec-title">Prochains Événements</div></div>
                    <div className="task-list">
                      {allEvents.filter(e=>e.date>=todayStr).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10).map(ev => {
                        const deal = deals.find(d => d.id === ev.dealId);
                        const diff = Math.ceil((new Date(ev.date)-new Date(todayStr))/86400000);
                        return (
                          <div key={ev.id} className="task" onClick={() => ev.dealId && openDeal(ev.dealId)}>
                            <div className="task-main">
                              <div className="task-title">{ev.title}</div>
                              <div className="task-sub">{deal?.title || "Google Calendar"}{ev.time ? ` · ${ev.time}` : ""}</div>
                            </div>
                            <span className="date-badge" style={{background:diff===0?"#F5EDD6":"#F4F1E8",color:diff===0?"#9B7A2A":"#6B6B6B"}}>{diff===0?"Aujourd'hui":`Dans ${diff}j`}</span>
                          </div>
                        );
                      })}
                      {allEvents.filter(e=>e.date>=todayStr).length===0 && <div className="status-note">Aucun événement à venir.</div>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "owners" && (
            <>
              <Topbar title={t("topbar_owners")} subtitle={t("topbar_owners_sub")} {...topbarCommon} />
              <div className="content">
                <ErrorBoundary label="la page Investisseurs">
                  <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Chargement des investisseurs…</div>}>
                    <OwnersManager owners={owners} setOwners={setOwners} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </>
          )}

          {view === "leads" && (
            <>
              <Topbar title={t("topbar_leads")} subtitle={t("topbar_leads_sub")} {...topbarCommon} />
              <div className="content">
                <ErrorBoundary label="la page Leads">
                  <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Chargement des leads…</div>}>
                    <LeadsManager leads={leads} setLeads={setLeads} onCreateDealFromLead={createDealFromLead} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </>
          )}

          {view === "phonefinder" && (
            <ErrorBoundary label="Recherche Tél">
              <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Chargement de Recherche Tél…</div>}>
                <PhoneFinder
                  onExportFoundToLeads={importPhoneFinderResultsToLeads}
                  onOpenLeads={() => setView("leads")}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {view === "workspace" && (
            !current ? (
              <>
                <Topbar title={t("topbar_workspace")} subtitle={t("topbar_workspace_empty")} {...topbarCommon} />
                <div className="content">
                  <div className="card empty">
                    <div className="empty-ico">🏠</div>
                    <div className="empty-title">Aucun Deal</div>
                    <div className="empty-sub">Sélectionnez un deal dans la barre de gauche pour commencer.</div>
                    <button className="btn btn-gold" onClick={() => setModal("new")}>＋ Nouveau deal</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Topbar title={t("topbar_workspace")} subtitle={`${currentStageLabel} • ${current.address || "Adresse à compléter"}`} {...topbarCommon} />
                <div className="content">
                  <div className="ws-head">
                    <div style={{minWidth:0,flex:1}}>
                      <input className="ws-title" value={current.title} onChange={e => upd(current.id, d => ({ ...d, title:e.target.value }))} />
                      <div className="ws-addr">
                        {current.address || "Adresse / secteur à renseigner"}
                        {current.units ? <span style={{marginLeft:10,color:"var(--text2)"}}>• {current.units} unités</span> : null}
                        {current.askingPrice ? <span style={{marginLeft:10,fontWeight:700,color:"var(--gold)"}}>• {Number(current.askingPrice).toLocaleString("en-CA")} $</span> : null}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span className="stage-crumb">Mis à jour le {new Date(current.updatedAt).toLocaleDateString("fr-CA")}</span>
                      <button className="btn btn-sm" onClick={() => setModal("event")}>＋ Événement</button>
                      {isAdmin && (
                        <button className="btn btn-danger btn-sm" onClick={() => deleteDeal(current.id)}>{t("delete")}</button>
                      )}
                    </div>
                  </div>

                  <div className="stage-wrap">
                    <div className="stage-track">
                      {STAGES.map(s => {
                        const cl = current.checklists?.[s.id] || [];
                        const pct = cl.length ? Math.round(cl.filter(i=>i.done).length/cl.length*100) : null;
                        return (
                          <button key={s.id} className={`stage-btn${current.stage===s.id?" active":""}`} onClick={() => setStage(s.id)}>
                            {s.emoji} {s.label}{pct!==null && current.stage!==s.id ? ` ${pct}%` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="tabs">
                    {[ ["crm","CRM & Suivi"], ["notes","Notes"], ["documents",`Documents${(current.files||[]).length>0?` (${current.files.length})`:""}`], ["checklist",`Checklist${stageCL.length>0?` ${stagePct}%`:""}`], ["activity","Activité"] ].map(([id,label]) => (
                      <button key={id} className={`tab${tab===id?" active":""}`} onClick={() => setTab(id)}>{label}</button>
                    ))}
                  </div>

                  {tab === "crm" && (
                    <>
                      {!isAdmin && (
                        <FlagForReviewBanner
                          dealId={current.id}
                          existing={flaggedLeads.find(f => f.dealId === current.id) || null}
                          onFlag={flagDeal}
                          t={t}
                        />
                      )}
                      <div className="ws-grid">
                        <div className="card f-card">
                          <div className="f-title">Contact (vendeur / courtier)</div>
                          <div className="contact-top">
                            <div className="contact-avatar">{initials(current.contact?.name, "CT")}</div>
                            <div>
                              <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{current.contact?.name || "Contact principal"}</div>
                              <div style={{fontSize:11,color:"var(--text3)"}}>{current.contact?.role || "Rôle à définir"}</div>
                            </div>
                          </div>
                          {[ ["name","Nom"], ["phone","Téléphone"], ["email","Email"], ["company","Compagnie"], ["role","Rôle"] ].map(([k,lbl]) => (
                            <div key={k} className="f-row"><div className="f-lbl">{lbl}</div><input value={current.contact?.[k] || ""} onChange={e => upd(current.id,d => ({ ...d, contact:{ ...d.contact, [k]:e.target.value } }))} /></div>
                          ))}

                          <div className="call-actions">
                            <button className="btn btn-gold" disabled={calling} onClick={startDealCall}>
                              {calling ? "Appel en cours..." : "📞 Appeler ce contact"}
                            </button>
                            <button className="btn btn-sm" disabled={callsLoading} onClick={() => loadCallsForDeal(current.id)}>
                              {callsLoading ? "Chargement..." : "Actualiser appels"}
                            </button>
                          </div>

                          {callNotice.text && (
                            <div className={`status-note${callNotice.type === "error" ? " error" : ""}`} style={{ marginTop: 10 }}>
                              {callNotice.text}
                            </div>
                          )}

                          <div className="call-log-wrap">
                            <div className="f-title" style={{ marginBottom: 0 }}>Historique des appels</div>
                            {currentCalls.length === 0 ? (
                              <div className="status-note" style={{ marginTop: 8 }}>Aucun appel enregistré pour ce deal.</div>
                            ) : (
                              <div className="call-log-list">
                                {currentCalls.slice(0, 6).map((call) => {
                                  const transcriptState = call.transcript_status || "not_started";
                                  const transcriptClass =
                                    transcriptState === "completed"
                                      ? "success"
                                      : transcriptState === "failed"
                                        ? "failed"
                                        : transcriptState === "processing" || transcriptState === "pending_recording"
                                          ? "pending"
                                          : "neutral";

                                  return (
                                    <div key={call.id} className="call-log-item">
                                      <div className="call-log-top">
                                        <div>
                                          <div className="call-log-title">{call.lead_name || call.to || "Contact"}</div>
                                          <div className="call-log-sub">
                                            {fmtCallDateTime(call.created_at)} · {fmtDurationSeconds(call.duration_seconds)}
                                          </div>
                                        </div>
                                        <span className={`call-pill ${call.status === "completed" ? "success" : call.status === "failed" || call.status === "busy" || call.status === "no-answer" ? "failed" : "pending"}`}>
                                          {call.status || "inconnu"}
                                        </span>
                                      </div>

                                      <div className="call-log-meta">
                                        <span className={`call-pill ${transcriptClass}`}>
                                          Transcript: {transcriptState}
                                        </span>
                                        {call.recording_url && (
                                          <a className="btn btn-sm" href={`/api/calls/${encodeURIComponent(call.id)}/recording`} target="_blank" rel="noreferrer">
                                            Écouter
                                          </a>
                                        )}
                                        {(transcriptState === "failed" || transcriptState === "not_started") && call.recording_url && (
                                          <button className="btn btn-sm" onClick={() => retryCallTranscription(call.id)}>
                                            Relancer transcript
                                          </button>
                                        )}
                                      </div>

                                      {call.transcript && (
                                        <details className="call-transcript">
                                          <summary>Voir la transcription</summary>
                                          <div className="call-transcript-text">{call.transcript}</div>
                                        </details>
                                      )}
                                      {!call.transcript && call.transcript_error && (
                                        <div className="status-note error" style={{ marginTop: 8 }}>{call.transcript_error}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="card f-card">
                          <div className="f-title">Suivi & Priorité</div>
                          <div className="f-row">
                            <div className="f-lbl">Priorité</div>
                            <div className="pri-row">
                              {Object.entries(PRIORITY).map(([k,{label,color}]) => (
                                <button key={k} className="pri-btn" style={current.priority===k?{background:color+"18",borderColor:color,color}:undefined} onClick={() => upd(current.id,d => ({ ...d, priority:k }))}>{label}</button>
                              ))}
                            </div>
                          </div>
                          <div className="f-row"><div className="f-lbl">Nombre d'unités</div><input type="number" min="1" step="1" value={current.units || ""} onChange={e => upd(current.id,d => ({ ...d, units: e.target.value }))} placeholder="Ex: 6" /></div>
                          <div className="f-row"><div className="f-lbl">Prix demandé ($)</div><input type="number" min="0" step="1000" value={current.askingPrice || ""} onChange={e => upd(current.id,d => ({ ...d, askingPrice: e.target.value }))} placeholder="Ex: 900000" /></div>
                          <div className="f-row"><div className="f-lbl">Date de follow-up</div><input type="date" value={current.followUpDate || ""} onChange={e => upd(current.id,d => ({ ...d, followUpDate:e.target.value }))} /></div>
                          <div className="f-row"><div className="f-lbl">Note de suivi</div><input value={current.followUpNote || ""} onChange={e => upd(current.id,d => ({ ...d, followUpNote:e.target.value }))} placeholder="Ex: Rappeler pour contre-offre…" /></div>
                          <div className="f-row"><div className="f-lbl">Prochaine action</div><input value={current.nextAction || ""} onChange={e => upd(current.id,d => ({ ...d, nextAction:e.target.value }))} placeholder="Ex: Déposer l'offre d'achat" /></div>
                          <div className="f-row">
                            <div className="f-lbl">Adresse</div>
                            <AddressAutocomplete
                              value={current.address || ""}
                              onChange={v => {
                                delete geocodeSkipRef.current[current.id];
                                upd(current.id, d => ({ ...d, address: v, coords: null }));
                              }}
                              onSelect={s => {
                                delete geocodeSkipRef.current[current.id];
                                upd(current.id, d => ({ ...d, address: s.label, coords: { lat: s.lat, lng: s.lng } }));
                              }}
                              placeholder="Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="card f-card">
                        <div className="f-title">Enregistrer une activité</div>
                        <ActivityLogger dealId={current.id} onLog={addAct} />
                      </div>
                    </>
                  )}

                  {tab === "notes" && (
                    <div className="ws-grid">
                      <div className="card f-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div className="f-title" style={{marginBottom:0}}>Notes deal</div>
                          <button className={`ai-btn${aiLoadD?" loading":""}`} onClick={() => aiSummarize("deal")}>{aiLoadD?"Formatage...":"✦ Formater"}</button>
                        </div>
                        <textarea value={current.notesDeal || ""} onChange={e => upd(current.id,d => ({ ...d, notesDeal:e.target.value }))} placeholder="Prix demandé, état général, potentiel, quartier, historique, stratégie…" />
                        {current.aiDeal && <div className="ai-box"><div className="ai-box-lbl">✦ Notes CRM formatées</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiDeal}</div><button className="btn btn-sm" style={{marginTop:10}} onClick={() => upd(current.id,d => ({ ...d, aiDeal:"" }))}>Effacer</button></div>}
                      </div>

                      <div className="card f-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div className="f-title" style={{marginBottom:0}}>Notes vendeur</div>
                          <button className={`ai-btn${aiLoadV?" loading":""}`} onClick={() => aiSummarize("vendeur")}>{aiLoadV?"Formatage...":"✦ Formater"}</button>
                        </div>
                        <textarea value={current.notesVendeur || ""} onChange={e => upd(current.id,d => ({ ...d, notesVendeur:e.target.value }))} placeholder="Motivation du vendeur, délai, flexibilité prix, points sensibles, style de négociation…" />
                        {current.aiVendeur && <div className="ai-box"><div className="ai-box-lbl">✦ Notes CRM formatées</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiVendeur}</div><button className="btn btn-sm" style={{marginTop:10}} onClick={() => upd(current.id,d => ({ ...d, aiVendeur:"" }))}>Effacer</button></div>}
                      </div>
                    </div>
                  )}

                  {tab === "documents" && (
                    <>
                      {viewing && (
                        <div className="doc-modal">
                          <div className="doc-modal-top">
                            <div className="doc-modal-name">📄 {viewing.name}</div>
                            <div style={{display:"flex",gap:8,flexShrink:0}}>
                              <a href={viewing.dataUrl} download={viewing.name}><button className="btn btn-sm">Télécharger</button></a>
                              <button className="btn btn-sm" onClick={() => setViewing(null)}>Fermer</button>
                            </div>
                          </div>
                          <div className="doc-modal-body">
                            {viewing.type?.includes("pdf")
                              ? <iframe src={viewing.dataUrl} className="doc-modal-frame" title={viewing.name} />
                              : viewing.type?.includes("image")
                              ? <img src={viewing.dataUrl} alt={viewing.name} style={{maxWidth:"100%",maxHeight:"100%",display:"block",margin:"auto",objectFit:"contain",padding:16}} />
                              : (viewing.type?.includes("spreadsheet") || viewing.name?.match(/\.xlsx?$/i))
                              ? <ErrorBoundary label="le tableur">
                                  <Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Chargement du tableur…</div>}>
                                    <XlsxViewer dataUrl={viewing.dataUrl} />
                                  </Suspense>
                                </ErrorBoundary>
                              : <div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Prévisualisation non disponible. <a href={viewing.dataUrl} download={viewing.name} style={{color:"var(--gold)"}}>Télécharger</a></div>
                            }
                          </div>
                        </div>
                      )}

                      <div className={`doc-drop${dragging?" drag":""}`}
                        onDragOver={e => {e.preventDefault();setDragging(true);}}
                        onDragLeave={() => setDragging(false)}
                        onDrop={e => {e.preventDefault();setDragging(false);handleFiles(e.dataTransfer.files);}}
                        onClick={() => fileRef.current?.click()}>
                        <div style={{fontSize:30,marginBottom:8}}>📁</div>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>Glissez vos fichiers ici ou cliquez pour sélectionner</div>
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>PDF, images, Word, Excel — tous formats acceptés</div>
                        <input ref={fileRef} type="file" multiple style={{display:"none"}} onChange={e => handleFiles(e.target.files)} />
                      </div>

                      {(current.files||[]).length>0 && (
                        <div className="doc-grid">
                          {current.files.map(f => (
                            <div key={f.id} className="doc" onClick={() => setViewing(f)}>
                              <div className="doc-icon">{fileIco(f.type)}</div>
                              <div className="doc-name" title={f.name}>{f.name}</div>
                              <div className="doc-meta">{fmtSz(f.size)} · {new Date(f.uploadedAt).toLocaleDateString("fr-CA")}</div>
                              <button className="doc-del" onClick={e => {e.stopPropagation();delFile(f.id);}}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {(current.files||[]).length===0 && !viewing && <div className="status-note">Aucun document pour ce deal.</div>}
                    </>
                  )}

                  {tab === "checklist" && (
                    <div className="card f-card">
                      <div className="f-title">Checklist par étape</div>
                      <div className="cl-pills">
                        {STAGES.map(s => {
                          const cl = current.checklists?.[s.id] || [];
                          const pct = cl.length ? Math.round(cl.filter(i=>i.done).length/cl.length*100) : null;
                          return (
                            <button key={s.id} className={`cl-pill${clStage===s.id?" active":""}`} onClick={() => {
                              setClStage(s.id);
                              if (!current.checklists?.[s.id]) upd(current.id,d => ({ ...d, checklists:{ ...d.checklists, [s.id]:buildCL(s.id) } }));
                            }}>{s.label}{pct!==null ? ` ${pct}%` : ""}</button>
                          );
                        })}
                      </div>

                      {activeCL.length>0 && (
                        <>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginBottom:4,fontWeight:700}}>
                            <span>{activeCL.filter(i=>i.done).length} / {activeCL.length}</span><span>{donePct}%</span>
                          </div>
                          <div className="cl-progress"><div className="cl-bar" style={{width:`${donePct}%`}}/></div>
                        </>
                      )}

                      {activeCL.map(item => (
                        <div key={item.id} className="cl-item" onClick={() => toggleCL(clStage,item.id)}>
                          <div className={`cl-box${item.done?" done":""}`}>{item.done ? "✓" : ""}</div>
                          <span className={`cl-lbl${item.done?" done":""}`}>{item.label}</span>
                        </div>
                      ))}

                      <div style={{display:"flex",gap:8,marginTop:10}}>
                        <input value={clNew} onChange={e => setClNew(e.target.value)} placeholder="Ajouter un item…"
                          onKeyDown={e => {
                            if (e.key==="Enter" && clNew.trim()) {
                              upd(current.id,d => ({ ...d, checklists:{ ...d.checklists, [clStage]:[...(d.checklists?.[clStage]||[]), { id:`c_${Date.now()}`, label:clNew.trim(), done:false }] } }));
                              setClNew("");
                            }
                          }} />
                        <button className="btn btn-gold" onClick={() => {
                          if (clNew.trim()) {
                            upd(current.id,d => ({ ...d, checklists:{ ...d.checklists, [clStage]:[...(d.checklists?.[clStage]||[]), { id:`c_${Date.now()}`, label:clNew.trim(), done:false }] } }));
                            setClNew("");
                          }
                        }}>Ajouter</button>
                      </div>
                    </div>
                  )}

                  {tab === "activity" && (
                    <>
                      <div className="card f-card">
                        <div className="f-title">Enregistrer une activité</div>
                        <ActivityLogger dealId={current.id} onLog={addAct} />
                      </div>
                      <div className="card f-card">
                        <div className="f-title">Historique</div>
                        {(!current.activities || current.activities.length===0)
                          ? <div className="status-note">Aucune activité encore.</div>
                          : <div className="timeline">{current.activities.map(a => (
                              <div key={a.id} className="t-item">
                                <div className="t-dot"/>
                                <div className="t-text">{a.text}</div>
                                <div className="t-time">{new Date(a.time).toLocaleString("fr-CA",{dateStyle:"short",timeStyle:"short"})}</div>
                              </div>
                            ))}</div>
                        }
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
        <div className="mo" onClick={() => setModal(null)}>
          <div className="mo-box" onClick={e => e.stopPropagation()}>
            <div className="mo-title">Nouveau deal</div>
            <div className="f-row">
              <div className="f-lbl">Adresse de la propriété</div>
              <AddressAutocomplete
                autoFocus
                value={newTitle}
                onChange={v => { setNewTitle(v); setNewAddress(v); setNewAddrCoords(null); }}
                onSelect={s => { setNewTitle(s.label); setNewAddress(s.label); setNewAddrCoords({ lat: s.lat, lng: s.lng }); }}
                placeholder="Ex: 11 rue Molleur, Saint-Jean-sur-Richelieu"
              />
            </div>
            <div className="f-row" style={{display:"flex",gap:10}}>
              <div style={{flex:1}}>
                <div className="f-lbl">Nombre d'unités</div>
                <input type="number" min="1" step="1" value={newUnits} onChange={e => setNewUnits(e.target.value)} placeholder="Ex: 6" />
              </div>
              <div style={{flex:2}}>
                <div className="f-lbl">Prix demandé ($)</div>
                <input type="number" min="0" step="1000" value={newAskingPrice} onChange={e => setNewAskingPrice(e.target.value)} placeholder="Ex: 900000" onKeyDown={e => e.key === "Enter" && createDealFn()} />
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn" onClick={() => { setModal(null); setNewTitle(""); setNewAddress(""); setNewAddrCoords(null); setNewUnits(""); setNewAskingPrice(""); }}>Annuler</button>
              <button className="btn btn-gold" onClick={createDealFn}>Créer le deal</button>
            </div>
          </div>
        </div>
      )}

      {modal === "event" && (
        <div className="mo" onClick={() => setModal(null)}>
          <div className="mo-box" onClick={e => e.stopPropagation()}>
            <div className="mo-title">Nouvel événement</div>
            <div className="f-row"><div className="f-lbl">Titre</div><input autoFocus value={newEv.title} onChange={e => setNewEv(n => ({ ...n, title:e.target.value }))} placeholder="Ex: Inspection 320 rue Bouchard"/></div>
            <div className="f-row"><div className="f-lbl">Date</div><input type="date" value={newEv.date} onChange={e => setNewEv(n => ({ ...n, date:e.target.value }))}/></div>
            <div className="f-row"><div className="f-lbl">Heure (optionnel)</div><input type="time" value={newEv.time} onChange={e => setNewEv(n => ({ ...n, time:e.target.value }))}/></div>
            <div className="f-row">
              <div className="f-lbl">Associer à un deal</div>
              <select value={newEv.dealId || currentId || ""} onChange={e => setNewEv(n => ({ ...n, dealId:e.target.value }))}>
                <option value="">— Sélectionner —</option>
                {deals.map(d => <option key={d.id} value={d.id}>{dealLabel(d)}</option>)}
              </select>
            </div>
            <div className="mo-foot">
              <button className="btn" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-gold" onClick={addEvent}>Créer</button>
            </div>
          </div>
        </div>
      )}
      {appToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            maxWidth: 360,
            padding: "12px 16px",
            background: "#1A1A1A",
            color: "#fff",
            borderRadius: 10,
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            fontSize: 13,
            zIndex: 10000,
          }}
        >
          {appToast}
        </div>
      )}

      {/* Floating chatbox — bottom-right. Collapsed = 💬 gold bubble; expanded
          = small chat panel with messages, an input, and a send button. */}
      <ChatWidget
        open={chatOpen}
        setOpen={setChatOpen}
        messages={chatMessages}
        input={chatInput}
        setInput={setChatInput}
        busy={chatBusy}
        onSend={sendChat}
        t={t}
      />
    </>
  );
}

// XlsxViewer, LeadFiche, LeadListRow, LEAD_ROW_HEIGHT moved to ./components/*.jsx
// LeadsManager and PhoneFinder moved to ./pages/*.jsx (lazy-loaded above).


// AddressAutocomplete, DealMap, ActivityLogger moved to ./components/*.jsx
// (imported at the top of this file).

// ─── ChatWidget ────────────────────────────────────────────────────────────
// Floating OpenAI chat. Closed state = 💬 gold button bottom-right. Opened
// = compact chat panel with messages, an input, and a send button. Renders
// nothing auth-sensitive — `sendChat` / state lives in App().
function ChatWidget({ open, setOpen, messages, input, setInput, busy, onSend, t }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages, busy]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("chat_title")}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: "#C9A84C",
          color: "#fff",
          border: "none",
          boxShadow: "0 8px 24px rgba(201,168,76,0.45)",
          fontSize: 24,
          cursor: "pointer",
          zIndex: 9998,
          display: "grid",
          placeItems: "center",
        }}
      >
        💬
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 360,
        maxWidth: "92vw",
        height: 480,
        maxHeight: "80vh",
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          background: "linear-gradient(90deg, #C9A84C 0%, #D4B765 100%)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{fontSize: 13, fontWeight: 700, letterSpacing: 0.3}}>
          ✦ {t("chat_title")}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="close"
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            color: "#fff",
            width: 24,
            height: 24,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >×</button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          background: "#FAF8F2",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "#C9A84C" : "#fff",
              color: m.role === "user" ? "#fff" : "var(--text)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              lineHeight: 1.45,
            }}
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div
            style={{
              alignSelf: "flex-start",
              fontSize: 11,
              color: "var(--text3)",
              fontStyle: "italic",
              padding: "4px 10px",
            }}
          >
            {t("chat_thinking")}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 10,
          borderTop: "1px solid var(--border)",
          background: "#fff",
          display: "flex",
          gap: 6,
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !busy) onSend(input); }}
          placeholder={t("chat_placeholder")}
          disabled={busy}
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => onSend(input)}
          disabled={busy || !input.trim()}
          className="btn btn-gold btn-sm"
          style={{whiteSpace: "nowrap"}}
        >
          {t("chat_send")}
        </button>
      </div>
    </div>
  );
}

// ─── FlagForReviewBanner ───────────────────────────────────────────────────
// Yellow banner above the Workspace CRM tab. Employees only. Once the deal
// has a pending flag, the UI switches to "already submitted — update" mode
// so re-submitting with a new note replaces the prior entry (see flagDeal).
function FlagForReviewBanner({ dealId, existing, onFlag, t }) {
  const [note, setNote] = useState(existing?.note || "");
  const [justSent, setJustSent] = useState(false);
  const already = !!existing;

  const submit = () => {
    onFlag(dealId, note);
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2500);
  };

  return (
    <div style={{
      background: "#FFF8E1",
      border: "1px solid #E8D79A",
      borderRadius: 12,
      padding: "12px 14px",
      marginBottom: 14,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{fontSize: 13, fontWeight: 700, color: "#8D6A15"}}>
        {t("flag_banner")}
      </div>
      <div style={{display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap"}}>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t("flag_note_placeholder")}
          style={{
            flex: 1, minWidth: 200,
            border: "1px solid #E8D79A",
            background: "#fff",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
          }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
        />
        <button
          type="button"
          onClick={submit}
          className="btn btn-gold btn-sm"
          style={{whiteSpace: "nowrap"}}
        >
          {already ? t("flag_resubmit") : t("flag_submit")}
        </button>
      </div>
      {justSent && (
        <div style={{fontSize: 11, color: "#2D8C4E", fontWeight: 600}}>
          ✓ {t("flag_submitted")}
        </div>
      )}
    </div>
  );
}

// ─── LoginScreen ────────────────────────────────────────────────────────────
// Gold/white PIN login. Two user tiles (click to pick), 4-digit PIN input,
// Enter button, inline error when PIN is wrong. EN/FR toggle top-right to
// match the rest of the app. Deliberately tiny — not a security boundary,
// just a "who am I" picker that feeds the role-gated UI.
function LoginScreen({ users, onLogin, lang, setLang, t }) {
  const [selected, setSelected] = useState(users[0]?.id || "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!selected) return;
    const ok = onLogin(selected, pin);
    if (!ok) {
      setErr(t("login_error"));
      setPin("");
    } else {
      setErr("");
    }
  };

  const switchLabel = lang === "fr" ? "EN" : "FR";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "linear-gradient(160deg, #F5F3EE 0%, #FAF7EE 55%, #F0E7C9 100%)",
      display: "grid", placeItems: "center",
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      color: "#1A1A1A",
    }}>
      <button
        type="button"
        onClick={() => setLang(lang === "fr" ? "en" : "fr")}
        style={{
          position: "absolute", top: 20, right: 20,
          border: "1px solid #E8E3D8", background: "#fff",
          borderRadius: 10, padding: "6px 14px",
          fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
          cursor: "pointer",
        }}
      >
        {switchLabel}
      </button>

      <div style={{
        width: 400, maxWidth: "92vw",
        background: "#fff", border: "1px solid #E8E3D8",
        borderRadius: 16, padding: "32px 28px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.08)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            fontSize: 28, fontWeight: 700, letterSpacing: 2,
            color: "#1A1A1A",
          }}>SOCLE</div>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 4,
            color: "#C9A84C", marginTop: 2,
          }}>ACQUISITIONS</div>
          <div style={{ fontSize: 12, color: "#6B6B6B", marginTop: 10 }}>
            {t("login_tag")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {users.map(u => {
            const isActive = selected === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => { setSelected(u.id); setPin(""); setErr(""); }}
                style={{
                  flex: 1,
                  padding: "14px 10px",
                  borderRadius: 12,
                  border: `1.5px solid ${isActive ? "#C9A84C" : "#E8E3D8"}`,
                  background: isActive ? "#FAF5E6" : "#fff",
                  cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: isActive ? "#C9A84C" : "#F5F3EE",
                  color: isActive ? "#fff" : "#6B6B6B",
                  display: "grid", placeItems: "center",
                  fontWeight: 700, fontSize: 14,
                }}>
                  {u.initials}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1A1A" }}>{u.name}</div>
                <div style={{ fontSize: 10, color: "#A0A0A0" }}>
                  {(u.roleLabel && u.roleLabel[lang]) || u.role}
                </div>
              </button>
            );
          })}
        </div>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          value={pin}
          placeholder={t("login_pin_placeholder")}
          onChange={e => { setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 18, letterSpacing: 8, textAlign: "center",
            border: `1.5px solid ${err ? "#C0392B" : "#E8E3D8"}`,
            borderRadius: 10,
            outline: "none",
            marginBottom: 10,
          }}
        />
        {err && (
          <div style={{ fontSize: 12, color: "#C0392B", textAlign: "center", marginBottom: 8 }}>
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={pin.length < 4}
          style={{
            width: "100%",
            padding: "12px",
            background: pin.length < 4 ? "#E8E3D8" : "#C9A84C",
            color: pin.length < 4 ? "#A0A0A0" : "#fff",
            border: "none", borderRadius: 10,
            fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
            cursor: pin.length < 4 ? "not-allowed" : "pointer",
          }}
        >
          {t("login_submit")}
        </button>
      </div>
    </div>
  );
}
