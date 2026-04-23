// Row renderer for react-window's FixedSizeList. Kept at module scope so
// the component identity is stable across parent renders (FixedSizeList
// uses strict equality on its `children` prop to decide whether to
// recreate row components). Stage badge copy comes from LEAD_STAGE_CFG
// in ../lib/stages.js — keep in sync with the STAGE_CFG declared inside
// LeadsManager if those ever drift apart.

import { LEAD_STAGE_CFG } from "../lib/stages.js";
import { mergePhoneLists } from "../lib/phoneUtils.js";
import { BuildingIcon, MapPinIcon, PhoneIcon } from "./Icons.jsx";

// Fixed row height for the virtualized leads list. Must stay in sync
// with the row layout below (padding + three text lines). 80px gives
// comfortable 44px+ tap area on mobile while fitting desktop well too.
export const LEAD_ROW_HEIGHT = 80;

export default function LeadListRow({ index, style, data }) {
  const lead = data.leads[index];
  if (!lead) return null;
  const stage = LEAD_STAGE_CFG[lead.stage] || LEAD_STAGE_CFG.new;
  const phones = mergePhoneLists(lead?.phones || [], lead?.phone, lead?.originalPhone);
  const isSel = data.selectedLeadId === lead.id;
  return (
    <div
      style={{
        ...style,
        padding: "12px 14px",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        background: isSel ? "#FFFBF1" : "transparent",
        borderLeft: isSel ? "3px solid var(--gold,#C9A84C)" : "3px solid transparent",
        boxSizing: "border-box",
      }}
      onClick={() => data.onSelect(lead.id)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {lead.companyName || lead.contactName || "—"}
        </div>
        <span className={"pf-status " + stage.cls} style={{ fontSize: 10, flexShrink: 0 }}>{stage.label}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <BuildingIcon size={11} style={{marginRight:4}} />{lead.buildingAddress || "—"}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "center" }}>
        {lead.city && <span style={{ fontSize: 10, color: "var(--text3)" }}><MapPinIcon size={10} style={{marginRight:2}} />{lead.city}</span>}
        {lead.units > 0 && <span style={{ fontSize: 10, color: "var(--text3)" }}>{lead.units} u.</span>}
        {phones.length > 0
          ? <span style={{ fontSize: 10, color: "#166534", fontWeight: 600, marginLeft: "auto" }}><PhoneIcon size={10} style={{marginRight:2}} />{phones[0]}</span>
          : <span style={{ fontSize: 10, color: "var(--text3)", marginLeft: "auto" }}>sans tél.</span>}
      </div>
    </div>
  );
}
