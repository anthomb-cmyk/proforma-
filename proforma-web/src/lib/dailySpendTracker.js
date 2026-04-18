// Persistent tally of phone-lookup spend, bucketed by calendar day.
// Two public helpers:
//
//   loadTodaySpend()              → { date, rows, estCost }
//   recordBatch(rows, estCost)    → updated { date, rows, estCost }
//
// Stored under the key `pf_daily_spend` as { date: "YYYY-MM-DD", rows, estCost }.
// A new calendar day silently resets the tally — we only care about
// "what did I spend today?", not a rolling history.
//
// Why localStorage instead of state: the tally must survive page
// reloads and cross-tab opens during a single work day. SessionStorage
// would reset on close; IndexedDB is overkill for two numbers.
//
// Invalid / corrupted entries degrade to today-zero rather than
// throwing; a bad JSON parse just means we lose one day of accounting,
// which is acceptable. We never want the counter crashing the UI.

const KEY = "pf_daily_spend";

// Local-day key (YYYY-MM-DD). Using local time means the reset boundary
// lines up with what the user thinks of as "today" — a batch at 23:50
// local counts toward today's spend, not tomorrow's, even if UTC has
// already ticked over.
export function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.date !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeGetStorage() {
  // localStorage can throw in private-mode Safari + some corp policies.
  // Fall back to an in-memory stub so the caller never crashes — worst
  // case we lose persistence across reloads.
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTodaySpend(now = new Date()) {
  const s = safeGetStorage();
  const today = todayKey(now);
  const empty = { date: today, rows: 0, estCost: 0 };
  if (!s) return empty;
  const parsed = safeParse(s.getItem(KEY));
  if (!parsed || parsed.date !== today) return empty;
  return {
    date: today,
    rows: Number.isFinite(parsed.rows) ? parsed.rows : 0,
    estCost: Number.isFinite(parsed.estCost) ? parsed.estCost : 0,
  };
}

export function recordBatch(rows, estCost, now = new Date()) {
  const current = loadTodaySpend(now);
  const next = {
    date: current.date,
    rows: current.rows + Math.max(0, Math.round(rows || 0)),
    estCost: current.estCost + Math.max(0, Number(estCost) || 0),
  };
  const s = safeGetStorage();
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(next));
    } catch {
      // Quota / disabled — keep returning the updated object so the UI
      // still reflects this batch in-memory, even if the next reload
      // forgets about it.
    }
  }
  return next;
}

export function clearTodaySpend() {
  const s = safeGetStorage();
  if (s) {
    try { s.removeItem(KEY); } catch { /* no-op */ }
  }
}
