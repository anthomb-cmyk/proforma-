import { useState, useMemo, useCallback, useEffect, useRef } from "react";

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

.content{padding:22px;overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:14px}
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
.xlsx-table-wrap{overflow:auto;flex:1;background:#fafaf8}
.xlsx-table{border-collapse:collapse;font-size:13px;width:100%}
.xlsx-table td{border:1px solid #ece6d8;padding:7px 14px;vertical-align:middle;color:#2a1f0e;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xlsx-table tr:nth-child(even) td{background:#f8f5f0}
.xlsx-table tr:nth-child(odd) td{background:#fff}
.xlsx-table tr:hover td{background:#f2ead6}
.xlsx-table td.cell-num{text-align:right;font-variant-numeric:tabular-nums;font-weight:500;color:#2a1f0e}
.xlsx-table td.cell-head{font-weight:700;color:#fff;background:#8a7355!important;letter-spacing:.04em;font-size:11px;text-transform:uppercase}
.xlsx-table td.cell-empty{border-color:transparent!important}
.xlsx-table td:first-child{color:#5a4a32;font-weight:500;background:#faf7f2!important}
.xlsx-table td.cell-head:first-child{background:#8a7355!important;color:#fff}
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
  high:   { label: "Haute",   color: "#C0392B", tag: "CHAUD", cls: "pr-hot", score: 3 },
  medium: { label: "Moyenne", color: "#B7791F", tag: "TIÈDE", cls: "pr-warm", score: 2 },
  low:    { label: "Basse",   color: "#2563EB", tag: "FROID", cls: "pr-cold", score: 1 },
};

function buildCL(stageId) {
  return (CHECKLISTS[stageId] || []).map((label, i) => ({ id: `${stageId}_${i}`, label, done: false }));
}

function createDeal(title, address = "", coords = null) {
  const now = Date.now();
  return {
    id: `acq_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: title || "Nouveau deal",
    address: address || "",
    coords: coords || null,
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

function normalizeDeal(d) {
  const lat = Number(d?.coords?.lat);
  const lng = Number(d?.coords?.lng);
  return {
    ...d,
    address: d?.address || "",
    coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

function fmtSz(b) { return b < 1048576 ? `${Math.round(b/1024)} KB` : `${(b/1048576).toFixed(1)} MB`; }
function fileIco(t) {
  if (t?.includes("pdf")) return "📄";
  if (t?.includes("image")) return "🖼️";
  if (t?.includes("word") || t?.includes("document")) return "📝";
  if (t?.includes("sheet") || t?.includes("excel")) return "📊";
  return "📎";
}
function initials(name, fallback = "DL") {
  const n = (name || "").trim();
  if (!n) return fallback;
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "").join("") || fallback;
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

function fmtCallDateTime(value) {
  if (!value) return "Date inconnue";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return date.toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" });
}

function fmtDurationSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m${rem > 0 ? ` ${rem}s` : ""}`;
}

function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stageColor(stageId) {
  return STAGES.find(s => s.id === stageId)?.color || "#6B7280";
}

function clusterDeals(items, zoom) {
  if (zoom >= 9) return items.map(item => ({ items:[item], lat:item.coords.lat, lng:item.coords.lng }));
  const threshold = zoom <= 6 ? 1.1 : zoom === 7 ? 0.55 : 0.3;
  const groups = [];
  items.forEach((item) => {
    const found = groups.find((g) => Math.hypot(g.lat - item.coords.lat, g.lng - item.coords.lng) <= threshold);
    if (!found) {
      groups.push({ items:[item], lat:item.coords.lat, lng:item.coords.lng });
      return;
    }
    found.items.push(item);
    const n = found.items.length;
    found.lat = (found.lat * (n - 1) + item.coords.lat) / n;
    found.lng = (found.lng * (n - 1) + item.coords.lng) / n;
  });
  return groups;
}

function NavIcon({ id }) {
  if (id === "map") return <span style={{fontSize:14,lineHeight:1}}>📍</span>;
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (id === "dashboard") return <svg {...common}><path d="M3 13h8V3H3zM13 21h8v-8h-8zM13 3h8v6h-8zM3 21h8v-4H3z"/></svg>;
  if (id === "pipeline") return <svg {...common}><path d="M4 6h7v5H4zM13 13h7v5h-7zM4 13h7v5H4zM13 6h7v5h-7z"/></svg>;
  if (id === "followups") return <svg {...common}><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>;
  return <svg {...common}><path d="M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>;
}

function Topbar({ title, subtitle, overdue }) {
  return (
    <div className="topbar">
      <div>
        <div className="tb-title">{title}</div>
        {subtitle ? <div className="tb-sub">{subtitle}</div> : null}
      </div>
      <div className="tb-right">
        <input className="tb-search" placeholder="Rechercher un deal, contact..." />
        <div className="bell" title="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>
          {overdue > 0 && <span className="bell-badge">{overdue}</span>}
        </div>
        <span className="tb-user">Anthony Makeen</span>
      </div>
    </div>
  );
}

export default function App() {
  const stored = load();
  const [deals, setDeals]         = useState((stored?.deals || []).map(normalizeDeal));
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

  useEffect(() => { persist({ deals, currentId, gcalOk }); }, [deals, currentId, gcalOk]);

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

  const createDealFn = () => {
    const d = createDeal(newTitle.trim() || "Nouveau deal", newAddress.trim(), newAddrCoords);
    setDeals(p => [d, ...p]);
    setCurrentId(d.id);
    setModal(null);
    setNewTitle("");
    setNewAddress("");
    setNewAddrCoords(null);
    setAddrSuggestions([]);
    setView("workspace");
    setTab("crm");
  };

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
    if (!text?.trim()) { alert("Ajoutez des notes avant de résumer."); return; }
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
              { id:"dashboard", label:"Dashboard" },
              { id:"pipeline", label:"Pipeline" },
              { id:"map", label:"Carte" },
              { id:"followups", label:"Follow-ups" },
              { id:"calendar", label:"Calendrier" },
            ].map(item => (
              <button key={item.id} className={`nav-item${view===item.id?" active":""}`} onClick={() => setView(item.id)}>
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
                    <div className="deal-title">{d.title}</div>
                    <div className="deal-meta">
                      <span className="stage-pill-mini" style={{background:st.color+"22",color:st.color}}>{st.label}</span>
                      <span style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.contact?.name || "Sans contact"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="new-btn" onClick={() => setModal("new")}>＋ Nouveau deal</button>

          <div className="sb-profile">
            <div className="p-avatar">AM</div>
            <div>
              <div className="p-name">Anthony Makeen</div>
              <div className="p-role">Président</div>
            </div>
          </div>
        </aside>

        <main className="main">
          {view === "dashboard" && (
            <>
              <Topbar title="Dashboard" overdue={stats.overdue} />
              <div className="content">
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
                          <DealMap deals={geocodedDeals} onOpenDeal={openDeal} interactive={false} height={280} />
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
                              <div className="task-title">{d.title}</div>
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
                              <div className="opp-title">{d.title}</div>
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
              <Topbar title="Pipeline" overdue={stats.overdue} />
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
                                <div className="k-title">{d.title}</div>
                                <div className="k-contact"><div className="k-c-av">{initials(d.contact?.name, "CT")}</div><span className="k-c-name">{d.contact?.name || "Contact à définir"}</span></div>
                                <div className="k-price">Prix: À valider</div>
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
              <Topbar title="Carte" subtitle="Vue géographique des deals au Québec" overdue={stats.overdue} />
              <div className="content">
                <div className="map-layout">
                  <div className="map-wrap">
                    <DealMap deals={filteredMapDeals} onOpenDeal={openDeal} interactive height={"calc(100vh - 140px)"} />
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
              <Topbar title="Follow-ups" overdue={stats.overdue} />
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
                              <div className="task-title">{d.title}</div>
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
              <Topbar title="Calendrier" overdue={stats.overdue} />
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

          {view === "workspace" && (
            !current ? (
              <>
                <Topbar title="Workspace" subtitle="Sélectionnez un deal" overdue={stats.overdue} />
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
                <Topbar title="Workspace" subtitle={`${currentStageLabel} • ${current.address || "Adresse à compléter"}`} overdue={stats.overdue} />
                <div className="content">
                  <div className="ws-head">
                    <div style={{minWidth:0,flex:1}}>
                      <input className="ws-title" value={current.title} onChange={e => upd(current.id, d => ({ ...d, title:e.target.value }))} />
                      <div className="ws-addr">
                        {current.address || "Adresse / secteur à renseigner"}
                        {current.units ? <span style={{marginLeft:10,color:"var(--text2)"}}>• {current.units} unités</span> : null}
                        {current.askingPrice ? <span style={{marginLeft:10,fontWeight:700,color:"var(--gold)"}}>• {Number(current.askingPrice).toLocaleString("fr-CA")} $</span> : null}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span className="stage-crumb">Mis à jour le {new Date(current.updatedAt).toLocaleDateString("fr-CA")}</span>
                      <button className="btn btn-sm" onClick={() => setModal("event")}>＋ Événement</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteDeal(current.id)}>Supprimer</button>
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
                          <button className={`ai-btn${aiLoadD?" loading":""}`} onClick={() => aiSummarize("deal")}>{aiLoadD?"Analyse...":"✦ IA"}</button>
                        </div>
                        <textarea value={current.notesDeal || ""} onChange={e => upd(current.id,d => ({ ...d, notesDeal:e.target.value }))} placeholder="Prix demandé, état général, potentiel, quartier, historique, stratégie…" />
                        {current.aiDeal && <div className="ai-box"><div className="ai-box-lbl">✦ Résumé IA</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiDeal}</div><button className="btn btn-sm" style={{marginTop:10}} onClick={() => upd(current.id,d => ({ ...d, aiDeal:"" }))}>Effacer</button></div>}
                      </div>

                      <div className="card f-card">
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <div className="f-title" style={{marginBottom:0}}>Notes vendeur</div>
                          <button className={`ai-btn${aiLoadV?" loading":""}`} onClick={() => aiSummarize("vendeur")}>{aiLoadV?"Analyse...":"✦ IA"}</button>
                        </div>
                        <textarea value={current.notesVendeur || ""} onChange={e => upd(current.id,d => ({ ...d, notesVendeur:e.target.value }))} placeholder="Motivation du vendeur, délai, flexibilité prix, points sensibles, style de négociation…" />
                        {current.aiVendeur && <div className="ai-box"><div className="ai-box-lbl">✦ Résumé IA</div><div style={{whiteSpace:"pre-wrap"}}>{current.aiVendeur}</div><button className="btn btn-sm" style={{marginTop:10}} onClick={() => upd(current.id,d => ({ ...d, aiVendeur:"" }))}>Effacer</button></div>}
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
                              ? <XlsxViewer dataUrl={viewing.dataUrl} />
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
              <div className="f-lbl">Nom / Adresse de la propriété</div>
              <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu" onKeyDown={e => e.key === "Enter" && createDealFn()} />
            </div>
            <div className="f-row">
              <div className="f-lbl">Adresse (pour la carte)</div>
              <AddressAutocomplete
                value={newAddress}
                onChange={v => { setNewAddress(v); setNewAddrCoords(null); }}
                onSelect={s => { setNewAddress(s.label); setNewAddrCoords({ lat: s.lat, lng: s.lng }); }}
                placeholder="Ex: 320 rue Bouchard, Saint-Jean-sur-Richelieu"
              />
            </div>
            <div className="mo-foot">
              <button className="btn" onClick={() => { setModal(null); setNewAddress(""); setNewAddrCoords(null); }}>Annuler</button>
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
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div className="mo-foot">
              <button className="btn" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-gold" onClick={addEvent}>Créer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function XlsxViewer({ dataUrl }) {
  const [sheets, setSheets] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const XLSX = window.XLSX;
    if (!XLSX) { setError("SheetJS non chargé."); return; }
    try {
      const base64 = dataUrl.split(",")[1];
      const workbook = XLSX.read(base64, { type: "base64" });
      const parsed = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" })
      }));
      setSheets(parsed);
    } catch {
      setError("Impossible de lire le fichier Excel.");
    }
  }, [dataUrl]);

  if (error) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>{error}</div>;
  if (!sheets) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Chargement…</div>;

  const current = sheets[activeSheet];
  const maxCols = Math.max(...current.rows.map(r => r.length), 0);
  // Drop fully empty rows
  const rows = current.rows.filter(r => r.some(c => c !== "" && c !== null && c !== undefined));

  // Find which columns have ANY data across all rows
  const colUsed = Array.from({length: maxCols}, (_, c) => rows.some(r => String(r[c] ?? "").trim() !== ""));

  // Split into column sections separated by fully-empty columns
  const sections = [];
  let start = -1;
  for (let c = 0; c <= maxCols; c++) {
    const used = c < maxCols && colUsed[c];
    if (used && start === -1) start = c;
    if (!used && start !== -1) { sections.push([start, c - 1]); start = -1; }
  }

  function isEmpty(val) { return String(val ?? "").trim() === ""; }

  function cellClass(val) {
    const s = String(val ?? "").trim();
    if (!s) return "cell-empty";
    if (/^[A-Z][A-Z\s&\(\)\-\/]{3,}$/.test(s)) return "cell-head";
    if (!isNaN(Number(s.replace(/[$,%\s]/g, "")))) return "cell-num";
    return "";
  }

  function formatVal(val) {
    const s = String(val ?? "").trim();
    if (!s) return "";
    const num = Number(s.replace(/[$,%\s]/g, ""));
    if (!isNaN(num)) {
      const rounded = Number.isInteger(num) ? num : Math.round(num * 100) / 100;
      const parts = String(Math.abs(rounded)).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (rounded < 0 ? "-" : "") + parts.join(".");
    }
    return s;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {sheets.length > 1 && (
        <div className="xlsx-tabs">
          {sheets.map((s, i) => (
            <button key={i} className={`btn btn-sm${i===activeSheet?" btn-gold":""}`} onClick={() => setActiveSheet(i)}>{s.name}</button>
          ))}
        </div>
      )}
      <div className="xlsx-table-wrap" style={{padding:16}}>
        <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
          {sections.map(([s, e], si) => {
            // Filter rows that have any content in this section's columns
            const secRows = rows.filter(row => row.slice(s, e+1).some(c => !isEmpty(c)));
            if (!secRows.length) return null;
            return (
              <table key={si} className="xlsx-table" style={{flexShrink:0,borderRadius:8,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
                <tbody>
                  {secRows.map((row, r) => (
                    <tr key={r}>
                      {Array.from({length: e - s + 1}, (_, ci) => {
                        const val = row[s + ci] ?? "";
                        return <td key={ci} className={cellClass(val)} title={String(val)}>{formatVal(val)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AddressAutocomplete({ value, onChange, onSelect, placeholder, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [dropRect, setDropRect] = useState(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchSuggestions = useCallback(async (query) => {
    if (!query || query.length < 3) { setSuggestions([]); return; }
    const q = encodeURIComponent(query);
    try {
      // Photon: autocomplete engine on OSM data, biased toward Quebec (Montreal coords)
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${q}&lat=45.5088&lon=-73.5878&limit=6&lang=fr`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      const features = data?.features;
      if (!Array.isArray(features) || features.length === 0) { setSuggestions([]); return; }
      const results = features
        .filter(f => {
          // Keep only Canadian results
          const country = f.properties?.country || "";
          return /canada/i.test(country);
        })
        .map(f => {
          const p = f.properties || {};
          const parts = [
            p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street || p.name || "",
            p.city || p.town || p.village || p.county || "",
            p.state || ""
          ].filter(Boolean);
          const label = parts.join(", ");
          const [lng, lat] = f.geometry?.coordinates || [null, null];
          return { label, lat: Number(lat), lng: Number(lng) };
        })
        .filter(r => r.label && Number.isFinite(r.lat));
      setSuggestions(results);
      if (inputRef.current && results.length > 0) {
        const rect = inputRef.current.getBoundingClientRect();
        setDropRect({ top: rect.bottom, left: rect.left, width: rect.width });
      }
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => fetchSuggestions(e.target.value), 400);
        }}
        onBlur={() => setTimeout(() => setSuggestions([]), 200)}
        placeholder={placeholder}
        style={style}
      />
      {suggestions.length > 0 && dropRect && (
        <div style={{
          position:"fixed", top:dropRect.top, left:dropRect.left, width:dropRect.width,
          background:"#fff", border:"1px solid #e0d9cc", borderRadius:6,
          boxShadow:"0 4px 16px rgba(0,0,0,0.13)", zIndex:9999,
          maxHeight:220, overflowY:"auto"
        }}>
          {suggestions.map((s, i) => (
            <div key={i}
              style={{padding:"9px 12px",cursor:"pointer",fontSize:13,color:"#3a2e1e",borderBottom:"1px solid #f0ede8",lineHeight:1.4}}
              onMouseDown={() => { onSelect(s); setSuggestions([]); }}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DealMap({ deals, onOpenDeal, interactive = true, height = "calc(100vh - 140px)" }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const fittedRef = useRef(false);
  const [zoom, setZoom] = useState(7);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapElRef.current || mapRef.current) return;

    const map = L.map(mapElRef.current, {
      zoomControl: interactive,
      scrollWheelZoom: interactive,
      dragging: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      touchZoom: interactive,
      attributionControl: true,
    });
    map.setView([46.8139, -71.2080], 7);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setZoom(map.getZoom());

    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    if (!interactive || !mapRef.current) return;
    const map = mapRef.current;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, [interactive]);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    const safeDeals = (deals || []).filter((deal) => Number.isFinite(Number(deal?.coords?.lat)) && Number.isFinite(Number(deal?.coords?.lng)));
    const clusters = clusterDeals(safeDeals, interactive ? zoom : 7);

    clusters.forEach((group) => {
      if (group.items.length === 1) {
        const deal = group.items[0];
        const color = stageColor(deal.stage);
        const priority = PRIORITY[deal.priority || "medium"] || PRIORITY.medium;
        const icon = L.divIcon({
          className: "",
          html: `<div class="map-pin" style="background:${color}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -8],
        });
        const marker = L.marker([group.lat, group.lng], { icon }).addTo(layer);
        marker.bindPopup(`
          <div class="map-popup">
            <div class="map-popup-title">${esc(deal.title)}</div>
            <div class="map-popup-sub">${esc(STAGES.find((s) => s.id === deal.stage)?.label || "Prospection")}</div>
            <div class="map-popup-row">Contact: ${esc(deal.contact?.name || "N/A")}</div>
            <div class="map-popup-row">Priorité: <span class="map-pill" style="background:${priority.color}22;color:${priority.color}">${esc(priority.label)}</span></div>
            <div class="map-popup-row">Follow-up: ${esc(deal.followUpDate || "Non défini")}</div>
            <button class="map-open-btn" data-open-deal="${esc(deal.id)}">Ouvrir le deal</button>
          </div>
        `);
      } else {
        const icon = L.divIcon({
          className: "",
          html: `<div class="map-cluster-pin" style="background:${"#C9A84C"}">${group.items.length}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([group.lat, group.lng], { icon }).addTo(layer);
        const rows = group.items.slice(0, 8).map((deal) => (
          `<div class="map-popup-row">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stageColor(deal.stage)};margin-right:6px;"></span>
            ${esc(deal.title)}
            <button class="map-open-btn" data-open-deal="${esc(deal.id)}" style="padding:3px 7px;font-size:10px;margin-top:4px;margin-left:8px;">Ouvrir</button>
          </div>`
        )).join("");
        marker.bindPopup(`
          <div class="map-popup">
            <div class="map-popup-title">${group.items.length} deals proches</div>
            ${rows}
          </div>
        `);
      }
    });

    if (safeDeals.length > 0) {
      const bounds = L.latLngBounds(safeDeals.map((deal) => [Number(deal.coords.lat), Number(deal.coords.lng)]));
      if (!interactive || !fittedRef.current) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
        fittedRef.current = true;
      }
    } else if (!interactive) {
      map.setView([46.8139, -71.2080], 7);
    }

    setTimeout(() => map.invalidateSize(), 0);
  }, [deals, interactive, zoom]);

  const onPopupAction = useCallback((event) => {
    const target = event.target?.closest?.("[data-open-deal]");
    if (!target) return;
    const dealId = target.getAttribute("data-open-deal");
    if (!dealId) return;
    event.preventDefault();
    onOpenDeal(dealId);
  }, [onOpenDeal]);

  const mapHeight = typeof height === "number" ? `${height}px` : height;

  if (!window.L) {
    return <div className="status-note">Leaflet n&apos;est pas chargé.</div>;
  }

  return (
    <div onClick={onPopupAction}>
      <div ref={mapElRef} className={`map-viewport${interactive ? "" : " mini"}`} style={{height: mapHeight}} />
    </div>
  );
}

function ActivityLogger({ dealId, onLog }) {
  const [text, setText] = useState("");
  const QUICK = ["📞 Appel effectué","📧 Email envoyé","🤝 Rencontre faite","💰 Offre déposée","📋 Documents reçus","🔍 Inspection faite","🏦 Dossier financier soumis","✅ Condition levée"];

  return (
    <div>
      <div className="qa-wrap">
        {QUICK.map(q => <button key={q} className="qa-btn" onClick={() => onLog(dealId, q)}>{q}</button>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Note personnalisée…"
          onKeyDown={e => { if (e.key === "Enter" && text.trim()) { onLog(dealId,text.trim()); setText(""); } }} />
        <button className="btn btn-gold" onClick={() => { if (text.trim()) { onLog(dealId,text.trim()); setText(""); } }}>Log</button>
      </div>
    </div>
  );
}
