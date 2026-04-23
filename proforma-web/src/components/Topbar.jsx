// App-level title bar. Stateless; just renders the current page title and
// a tiny notifications indicator driven by `overdue` (count of overdue
// follow-ups). The previous Topbar included a search input with no
// onChange handler — purely decorative. Removed to avoid giving users a
// control that silently does nothing; re-introduce as a real global
// search when we wire one up.

export default function Topbar({ title, subtitle, overdue, userName, badgeCount, lang, onToggleLang, langSwitchLabel, onOpenNav }) {
  const badge = typeof badgeCount === "number" ? badgeCount : overdue;
  return (
    <div className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {onOpenNav && (
          <button
            type="button"
            className="mobile-hamburger"
            onClick={onOpenNav}
            aria-label="Menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="tb-title">{title}</div>
          {subtitle ? <div className="tb-sub">{subtitle}</div> : null}
        </div>
      </div>
      <div className="tb-right">
        {onToggleLang && (
          <button
            type="button"
            onClick={onToggleLang}
            title={lang === "fr" ? "Switch to English" : "Passer en français"}
            style={{
              border: "1px solid var(--border)",
              background: "#fff",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.3,
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            {langSwitchLabel || (lang === "fr" ? "EN" : "FR")}
          </button>
        )}
        <div className="bell" title="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>
          {badge > 0 && <span className="bell-badge">{badge}</span>}
        </div>
        <span className="tb-user">{userName || "Anthony Makeen"}</span>
      </div>
    </div>
  );
}
