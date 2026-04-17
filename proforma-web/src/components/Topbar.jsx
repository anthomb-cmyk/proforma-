// App-level title bar. Stateless; just renders the current page title and
// a tiny notifications indicator driven by `overdue` (count of overdue
// follow-ups). The previous Topbar included a search input with no
// onChange handler — purely decorative. Removed to avoid giving users a
// control that silently does nothing; re-introduce as a real global
// search when we wire one up.

export default function Topbar({ title, subtitle, overdue }) {
  return (
    <div className="topbar">
      <div>
        <div className="tb-title">{title}</div>
        {subtitle ? <div className="tb-sub">{subtitle}</div> : null}
      </div>
      <div className="tb-right">
        <div className="bell" title="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>
          {overdue > 0 && <span className="bell-badge">{overdue}</span>}
        </div>
        <span className="tb-user">Anthony Makeen</span>
      </div>
    </div>
  );
}
