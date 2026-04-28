// proforma-web/src/lib/searchBudget.js
//
// Per-session search-budget guard. Tracks /single calls per browser session
// (each call proxies ~5-12 Brave Search queries server-side).
// Persists to localStorage so a tab refresh doesn't reset the counter.
//
// localStorage key: pf_search_budget_v1
//   { used: number, cap: number, sessionStartedAt: number }

const STORAGE_KEY = "pf_search_budget_v1";
const DEFAULT_CAP = 500; // raised from 200 (Fix 7: ~13 queries/pkg now, covers 25-50 packages)

/** Return the default call cap (200). */
export function defaultCap() {
  return DEFAULT_CAP;
}

/** Load raw state from localStorage, returning a safe default when missing/corrupt. */
function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist state to localStorage. */
function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Swallow — storage may be full or disabled
  }
}

/**
 * Get current budget state.
 * @returns {{ used: number, cap: number, remaining: number, exhausted: boolean }}
 */
export function getBudgetState() {
  const raw = loadRaw();
  const used = Math.max(0, Number(raw?.used) || 0);
  const cap = Math.max(1, Number(raw?.cap) || DEFAULT_CAP);
  const remaining = Math.max(0, cap - used);
  return {
    used,
    cap,
    remaining,
    exhausted: used >= cap,
  };
}

/**
 * Increment the used counter.
 * @param {number} [by=1]
 * @returns {{ used: number, cap: number, remaining: number, exhausted: boolean }}
 */
export function incrementUsed(by = 1) {
  const raw = loadRaw();
  const used = Math.max(0, Number(raw?.used) || 0) + Math.max(0, Number(by) || 0);
  const cap = Math.max(1, Number(raw?.cap) || DEFAULT_CAP);
  const next = {
    used,
    cap,
    sessionStartedAt: raw?.sessionStartedAt || Date.now(),
  };
  persist(next);
  const remaining = Math.max(0, cap - used);
  return { used, cap, remaining, exhausted: used >= cap };
}

/**
 * Update the call cap.
 * @param {number} cap
 */
export function setCap(cap) {
  const raw = loadRaw();
  const used = Math.max(0, Number(raw?.used) || 0);
  const next = {
    used,
    cap: Math.max(1, Number(cap) || DEFAULT_CAP),
    sessionStartedAt: raw?.sessionStartedAt || Date.now(),
  };
  persist(next);
}

/** Reset used to 0 (preserves cap). */
export function resetBudget() {
  const raw = loadRaw();
  const cap = Math.max(1, Number(raw?.cap) || DEFAULT_CAP);
  persist({ used: 0, cap, sessionStartedAt: Date.now() });
}
