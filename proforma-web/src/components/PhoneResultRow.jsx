// Memoized <tr> renderer for the PhoneFinder results table.
//
// Extracted from src/pages/PhoneFinder.jsx so each row is a React.memo-able
// unit: when `filter.search` or `page` changes in PhoneFinder, only the rows
// whose `r` reference actually changed re-render. Without this extraction,
// every row recomputes filePhoneKeys / onlinePhoneKeys / pjPhoneKeys /
// c411PhoneKeys / sourceLabelForPhone on every parent render (~100 rows per
// page = lots of wasted work).
//
// The component stays intentionally dumb: it receives the already-filtered
// row `r`, its display index `i`, and the handlers it needs. Parent owns all
// state (review modal, run mutations, loading flags).

import { memo } from "react";
import { mergePhoneLists, normalizePhoneKey } from "../lib/phoneUtils.js";

const STATUS_CFG = {
  found:            { label: "Trouvé",         cls: "found" },
  needs_review:     { label: "À vérifier",     cls: "needs_review" },
  multiple_matches: { label: "Choix multiple", cls: "multiple_matches" },
  not_found:        { label: "Non trouvé",     cls: "not_found" },
};

function confClass(n) {
  return n >= 80 ? "hi" : n >= 60 ? "mid" : n >= 40 ? "lo" : "zero";
}

function prettyColName(colName) {
  return colName
    .replace(/Propri[eé]taire(\d+)[_\s]?[Tt][eé]l[eé]phone/i, "Prop.$1 Tél.")
    .replace(/[_\s]T[eé]l[eé]phone$/i, " Tél.")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function PhoneResultRow({
  r,
  i,
  loading,
  onReview,
  onRerun,
  onDelete,
}) {
  const sc = STATUS_CFG[r.status] || STATUS_CFG.not_found;
  const hasAlts =
    (r.status === "needs_review" || r.status === "multiple_matches") &&
    r.candidates?.length > 0;

  const filePhoneKeys = new Set(
    mergePhoneLists(r.fileInputPhones).map(normalizePhoneKey).filter(Boolean)
  );
  const onlinePhoneKeys = new Set(
    mergePhoneLists(r.onlinePhones).map(normalizePhoneKey).filter(Boolean)
  );
  const pjPhoneKeys = new Set(
    mergePhoneLists(r.pjDirectoryPhones || r.directoryPhones)
      .map(normalizePhoneKey)
      .filter(Boolean)
  );
  const c411PhoneKeys = new Set(
    mergePhoneLists(r.c411DirectoryPhones || [])
      .map(normalizePhoneKey)
      .filter(Boolean)
  );
  // Server-provided { normalizedPhoneKey → rawColumnName } map, so we can show
  // the exact Excel column name (e.g. "Propriétaire2_Téléphone") instead of a
  // generic "fichier" label. Older persisted runs may not have it.
  const filePhoneColumns = r.filePhoneColumns || {};

  const sourceLabelForPhone = (phone) => {
    const key = normalizePhoneKey(phone);
    if (!key) return "";
    const sources = [];
    const colName = filePhoneColumns[key];
    if (colName) {
      sources.push(prettyColName(colName));
    } else if (filePhoneKeys.has(key)) {
      sources.push("fichier");
    }
    if (onlinePhoneKeys.has(key)) sources.push("Google Places");
    if (pjPhoneKeys.has(key)) sources.push("Pages Jaunes");
    if (c411PhoneKeys.has(key)) sources.push("411.ca");
    return sources.join(" + ");
  };

  const listedPhones = mergePhoneLists(r.inputPhones);
  const primaryPhone = r.phone || listedPhones[0] || "";
  const primaryPhoneSource = primaryPhone ? sourceLabelForPhone(primaryPhone) : "";

  return (
    <tr>
      <td style={{ color: "var(--text3)", fontSize: 11, width: 36 }}>{i + 1}</td>
      <td className="pf-input-col">
        {(r.companyName || r.inputName) && (
          <div className="pf-cell-name">{r.companyName || r.inputName}</div>
        )}
        {(r.buildingAddress || r.inputAddress) && (
          <div className="pf-cell-addr">🏢 {r.buildingAddress || r.inputAddress}</div>
        )}
        {r.utilisation && (
          <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
            🏷 {r.utilisation}
          </div>
        )}
        {r.leadContact && (
          <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }}>
            👤 {r.leadContact}
          </div>
        )}
        {listedPhones.length > 0 && (
          <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }}>
            {listedPhones
              .map((phone) => {
                const src = sourceLabelForPhone(phone);
                return `📇 ${phone}${src ? ` · ${src}` : ""}`;
              })
              .join("  ")}
          </div>
        )}
        {r.error && (
          <div
            style={{ fontSize: 10, color: "var(--red)", marginTop: 2 }}
            title={r.error}
          >
            ⚠ {r.error.slice(0, 60)}
          </div>
        )}
      </td>
      <td className="pf-match-col">
        {r.matchedName && <div className="pf-cell-name">{r.matchedName}</div>}
        {r.matchedAddress && <div className="pf-cell-addr">{r.matchedAddress}</div>}
        {!r.matchedName && !r.matchedAddress && (
          <span style={{ color: "var(--text3)" }}>—</span>
        )}
      </td>
      <td>
        {r.phone ? (
          <span
            className="pf-phone"
            onClick={() => navigator.clipboard?.writeText(r.phone)}
            title="Copier"
          >
            📞 {r.phone}
          </span>
        ) : listedPhones.length > 0 ? (
          <span
            className="pf-phone"
            onClick={() => navigator.clipboard?.writeText(listedPhones.join(" / "))}
            title="Copier"
          >
            📇 {listedPhones[0]}
          </span>
        ) : (
          <span style={{ color: "var(--text3)" }}>—</span>
        )}
        {primaryPhoneSource && (
          <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
            📍 {primaryPhoneSource}
          </div>
        )}
      </td>
      <td className="pf-web-col">
        {r.website ? (
          <a
            href={r.website}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--blue)",
              fontSize: 11,
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.website.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : (
          <span style={{ color: "var(--text3)" }}>—</span>
        )}
      </td>
      <td style={{ textAlign: "center" }}>
        <span className={`pf-conf ${confClass(r.confidence)}`}>{r.confidence}%</span>
      </td>
      <td>
        <span className={`pf-status ${sc.cls}`}>{sc.label}</span>
      </td>
      <td>
        <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
          {hasAlts && (
            <button className="btn btn-sm btn-gold" onClick={() => onReview(r)}>
              Choisir
            </button>
          )}
          {r.status === "not_found" && r._src && (
            <button
              className="btn btn-sm"
              onClick={() => onRerun(r)}
              disabled={loading}
              title="Relancer la recherche pour cette ligne"
            >
              🔄
            </button>
          )}
          {(r.phone || (Array.isArray(r.inputPhones) && r.inputPhones.length > 0)) && (
            <button
              className="btn btn-sm"
              onClick={() =>
                navigator.clipboard?.writeText(
                  mergePhoneLists(r.phone, r.inputPhones).join(" / ")
                )
              }
              title="Copier"
            >
              📋
            </button>
          )}
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onDelete(r)}
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

// React.memo avoids re-rendering rows whose `r` reference hasn't changed.
// All callbacks are stable (useCallback in the parent); `loading` and `i`
// are primitive so they trigger re-render only when they actually change.
export default memo(PhoneResultRow);
