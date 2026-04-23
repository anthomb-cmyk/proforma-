import { LEAD_STAGE_CFG } from "../lib/stages.js";
import { mergePhoneLists } from "../lib/phoneUtils.js";
import { BuildingIcon, MapPinIcon, PhoneIcon } from "./Icons.jsx";

export const LEAD_ROW_HEIGHT = 80;

export default function LeadListRow({ index, style, data }) {
  const lead = data.leads[index];
  if (!lead) return null;
  const stage = LEAD_STAGE_CFG[lead.stage] || LEAD_STAGE_CFG.new;
  const phones = mergePhoneLists(lead?.phones || [], lead?.phone, lead?.originalPhone);
  const isSel = data.selectedLeadId === lead.id;
  const phone = phones[0] || null;

  return (
    <div
      style={{
        ...style,
        padding: "10px 16px 10px 14px",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        background: isSel ? "#FFFBF1" : "transparent",
        borderLeft: `4px solid ${isSel ? "var(--gold,#C9A84C)" : (stage.borderColor || "#E0D9CC")}`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
      }}
      onClick={() => data.onSelect(lead.id)}
    >
      {/* Line 1: company/contact name + stage pill */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {lead.companyName || lead.contactName || "—"}
        </div>
        <span className={"pf-status " + stage.cls} style={{ fontSize: 12, flexShrink: 0 }}>{stage.label}</span>
      </div>

      {/* Line 2: building address */}
      <div style={{ fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <BuildingIcon size={11} style={{ marginRight: 4, flexShrink: 0 }} />{lead.buildingAddress || "—"}
      </div>

      {/* Line 3: city · units  phone (tap-to-call) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {lead.city && <span style={{ fontSize: 12, color: "#888" }}><MapPinIcon size={10} style={{ marginRight: 2 }} />{lead.city}</span>}
        {lead.units > 0 && <span style={{ fontSize: 12, color: "#888" }}>{lead.units} u.</span>}
        {phone
          ? (
            <a
              href={`tel:${String(phone).replace(/\D+/g, "")}`}
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 12, fontWeight: 600, color: "#2E7D32", marginLeft: "auto", textDecoration: "none" }}
            >
              <PhoneIcon size={10} style={{ marginRight: 2 }} />{phone}
            </a>
          )
          : <span style={{ fontSize: 11, color: "#cc0000", marginLeft: "auto" }}>sans tél.</span>}
      </div>
    </div>
  );
}
