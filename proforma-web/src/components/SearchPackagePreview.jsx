// proforma-web/src/components/SearchPackagePreview.jsx
//
// Dev-only modal that previews the search packages buildSearchPackages()
// would produce for a set of imported rows — BEFORE any paid lookup runs.
// Mounted only when the dev flag is on (see lib/searchPackageDebug.js).
//
// Pure presentational. All shape work lives in
// lib/searchPackageDebug.js#buildSearchPackagePreviewData so the tests can
// run without @testing-library/react.

import { useMemo } from "react";
import { buildSearchPackagePreviewData } from "../lib/searchPackageDebug.js";
import { CloseIcon } from "./Icons.jsx";

const cellLabel = { fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 };
const cellValue = { fontSize: 18, fontWeight: 700, color: "var(--text)" };
const subValue = { fontSize: 12, color: "var(--text2)", marginTop: 2 };
const card = {
  background: "var(--surface, #FFFDF7)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
};

function StatTile({ label, value, sub }) {
  return (
    <div style={card}>
      <div style={cellLabel}>{label}</div>
      <div style={cellValue}>{value}</div>
      {sub ? <div style={subValue}>{sub}</div> : null}
    </div>
  );
}

function Bucket({ entries }) {
  // entries: [[key, count], …]
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {entries.map(([k, v]) => (
        <span key={k} style={{
          background: "#EEF2FF", color: "#3730A3", borderRadius: 6,
          padding: "2px 8px", fontSize: 11, fontWeight: 600,
        }}>{k}={v}</span>
      ))}
    </div>
  );
}

export default function SearchPackagePreview({ rows, onClose, topN = 25 }) {
  const data = useMemo(
    () => buildSearchPackagePreviewData(rows, { topN }),
    [rows, topN],
  );

  return (
    <div className="mo" onClick={onClose}>
      <div
        className="mo-box"
        style={{ maxWidth: 880, width: "94vw", maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="mo-title" style={{ marginBottom: 0 }}>
            Search-package preview
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>
              dev only · no API call
            </span>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            <CloseIcon size={11} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 10 }}>
          {data.inputRowCount} input rows → <strong>{data.packageCount}</strong> packages
        </div>

        {/* Top stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
          <StatTile label="Total packages" value={data.packageCount} />
          <StatTile label="With phone" value={data.withPhone}
            sub={`owner-direct: ${data.withOwnerFilePhone}`} />
          <StatTile label="Without phone" value={data.withoutPhone} />
          <StatTile label="Numbered companies" value={data.numberedCompanies} />
          <StatTile label="Trusts / fiducies" value={data.trusts} />
          <StatTile label="Same-name diff. address" value={data.duplicateDifferentAddress}
            sub="informational" />
        </div>

        {/* Lead value vs search need breakdowns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={card}>
            <div style={cellLabel}>Lead value</div>
            <Bucket entries={[
              ["high", data.leadValue.high],
              ["medium", data.leadValue.medium],
              ["low", data.leadValue.low],
            ]} />
          </div>
          <div style={card}>
            <div style={cellLabel}>Search need</div>
            <Bucket entries={[
              ["high", data.searchNeed.high],
              ["medium", data.searchNeed.medium],
              ["low", data.searchNeed.low],
              ["skip", data.searchNeed.skip],
            ]} />
          </div>
        </div>

        {/* Top high-value owners without any phone */}
        <div style={{ ...card, padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              Top {Math.min(topN, data.topHighValueWithoutPhone.length)} high-value owners without phone
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>
              sorted by portfolio (properties / units)
            </div>
          </div>
          {data.topHighValueWithoutPhone.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>(none)</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text3)" }}>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>#</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Owner</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Category</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Strategy</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Props</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Units</th>
                  <th style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>Mailing</th>
                </tr>
              </thead>
              <tbody>
                {data.topHighValueWithoutPhone.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>{i + 1}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{row.name}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>{row.category}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)" }}>{row.strategy}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{row.properties}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{row.units || "—"}</td>
                    <td style={{ padding: "4px 6px", borderBottom: "1px solid var(--border)", color: "var(--text2)" }}>
                      {[row.mailingAddress, row.mailingCity].filter(Boolean).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: "var(--text3)" }}>
          To toggle this preview: <code>localStorage.setItem("pf_spdebug", "1")</code> · refresh
        </div>
      </div>
    </div>
  );
}
