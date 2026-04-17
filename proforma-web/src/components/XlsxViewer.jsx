// Renders an uploaded .xlsx file as an HTML table with the exact 3-panel
// layout used in our proforma spreadsheet (left=B–E, center=F–I, right=K–M,
// columns A and J are spacers). Reads SheetJS from window.XLSX (loaded via
// <script> tag in index.html) and preserves bold/percent cell formatting
// from the source workbook so the rendered version visually matches Excel.

import { useState, useEffect } from "react";

export default function XlsxViewer({ dataUrl }) {
  const [sheets, setSheets] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const XLSX = window.XLSX;
    if (!XLSX) { setError("SheetJS non chargé."); return; }
    try {
      const base64 = dataUrl.split(",")[1];
      const wb = XLSX.read(base64, { type: "base64", cellStyles: true });
      const parsed = wb.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }),
        ws: wb.Sheets[name],
      }));
      setSheets(parsed);
    } catch { setError("Impossible de lire le fichier Excel."); }
  }, [dataUrl]);

  if (error) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>{error}</div>;
  if (!sheets) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"var(--text2)"}}>Chargement…</div>;

  const { rows, ws } = sheets[activeSheet];
  const XLSX = window.XLSX;

  // Fixed 3-panel layout matching the proforma format:
  // Col A (idx 0) = spacer | B-E (1-4) = left | F-I (5-8) = center | J (9) = spacer | K-M (10-12) = right
  const PANELS = [[1,2,3,4], [5,6,7,8], [10,11,12]];
  const allPanelCols = PANELS.flat();

  const encCell = (r, c) => { try { return XLSX.utils.encode_cell({ r, c }); } catch { return ""; } };
  const getCell = (r, c) => { try { return ws[encCell(r,c)]; } catch { return undefined; } };
  const isBold = (r, c) => { try { return getCell(r,c)?.s?.font?.bold === true; } catch { return false; } };
  const isPercent = (r, c) => { try { const f = getCell(r,c)?.z || ""; return f.includes("%"); } catch { return false; } };
  const cellVal = (r, c) => rows[r]?.[c] ?? "";
  const cellStr = (r, c) => String(cellVal(r,c)).trim();

  function isNum(v) {
    if (v === "" || v == null) return false;
    if (typeof v === "number") return true;
    const s = String(v).replace(/[$,%\s]/g, "");
    return s !== "" && !isNaN(Number(s));
  }

  function fmt(v, ri, c) {
    if (v === "" || v == null) return "";
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
    if (isNaN(n)) return String(v).trim();
    if (isPercent(ri, c)) {
      return (n * 100).toFixed(1).replace(/\.0$/, "") + "%";
    }
    if (Number.isInteger(n)) return n.toLocaleString("en-CA");
    return n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Classify each row: "ph" (main header), "psh" (sub-header), "spacer", or "data"
  function rowType(ri) {
    if (allPanelCols.every(c => cellStr(ri, c) === "")) return "spacer";
    const b1 = PANELS[0][0]; // col B = index 1
    const v = cellStr(ri, b1);
    if (!v) return "data";
    const bold = isBold(ri, b1);
    const allCaps = v.length > 2 && v === v.toUpperCase() && /[A-Z]/.test(v);
    if (bold && allCaps) return "ph";
    if (bold) return "psh";
    return "data";
  }

  // Find last meaningful row
  let lastRow = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    if (allPanelCols.some(c => cellStr(ri, c) !== "")) lastRow = ri;
  }
  const rowIndices = Array.from({ length: lastRow + 1 }, (_, i) => i);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {sheets.length > 1 && (
        <div className="xlsx-tabs">
          {sheets.map((s, i) => (
            <button key={i} className={`btn btn-sm${i===activeSheet?" btn-gold":""}`} onClick={() => setActiveSheet(i)}>{s.name}</button>
          ))}
        </div>
      )}
      <div className="pf-wrap">
        {PANELS.map((pcols, pi) => {
          const hasData = rowIndices.some(ri => pcols.some(c => cellStr(ri, c) !== ""));
          if (!hasData) return null;
          return (
            <div key={pi} className="pf-panel">
              <table>
                <tbody>
                  {rowIndices.map(ri => {
                    const rt = rowType(ri);
                    if (rt === "spacer") {
                      return <tr key={ri} className="pspacer"><td colSpan={pcols.length}></td></tr>;
                    }
                    if (rt === "ph" || rt === "psh") {
                      // Show the header text from this panel, falling back to Panel 1's text
                      const headerText = pcols.map(c => cellStr(ri, c)).find(s => s !== "") || cellStr(ri, PANELS[0][0]);
                      return (
                        <tr key={ri}>
                          <td className={rt} colSpan={pcols.length}>{headerText}</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={ri}>
                        {pcols.map((c, ci) => {
                          const v = cellVal(ri, c);
                          const bold = isBold(ri, c);
                          const cls = (ci === 0 ? "plbl" : isNum(v) ? "pnum" : "") + (bold ? " pbold" : "");
                          return (
                            <td key={c} className={cls.trim()}>
                              {isNum(v) ? fmt(v, ri, c) : String(v ?? "").trim()}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
