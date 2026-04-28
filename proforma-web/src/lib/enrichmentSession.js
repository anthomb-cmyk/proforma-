// proforma-web/src/lib/enrichmentSession.js
//
// Persists in-flight contact-enrichment results across browser refreshes.
// A session is keyed by an import-session ID derived from the imported
// dataset signature so the same Excel file restores cleanly even after a
// browser crash or laptop sleep.
//
// State persisted per session:
//   - allEnrichedResults: Map<packageKey, EnrichResult>
//   - enrichedKeys:       Set<packageKey>
//   - exportedKeys:       Set<packageKey>
//   - reviewDecisions:    Map<packageKey, { decision: "accepted"|"rejected"|"skipped", at: number }>
//
// Storage shape: { v: 1, sessionId, savedAt, results: [...], decisions: [...], exported: [...] }

const NS = "pf_enrichment_session_v1";
const INDEX_KEY = `${NS}__index`;

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJSON(key, fallback) {
  const ls = safeStorage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    ls.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  const ls = safeStorage();
  if (!ls) return;
  try { ls.removeItem(key); } catch {}
}

// ─── Session ID derivation ────────────────────────────────────────────────

// Stable signature for an imported dataset. Combines row count + a sample of
// owner names + first/last package keys. Same Excel re-imported = same id.
export function deriveSessionId(packages) {
  const list = Array.isArray(packages) ? packages : [];
  if (!list.length) return "";
  const firstKey = list[0]?.lead_owner_name || list[0]?.companyName || "";
  const lastKey = list[list.length - 1]?.lead_owner_name || list[list.length - 1]?.companyName || "";
  const sampleNames = list.slice(0, 5).map((p) => p?.lead_owner_name || p?.companyName || "").join("|");
  const sig = `${list.length}::${firstKey}::${lastKey}::${sampleNames}`;
  // Cheap hash — same input always gives same id, no need for crypto.
  let h = 0;
  for (let i = 0; i < sig.length; i++) {
    h = ((h << 5) - h) + sig.charCodeAt(i);
    h |= 0;
  }
  return `s_${list.length}_${(h >>> 0).toString(36)}`;
}

// ─── Session save / load ──────────────────────────────────────────────────

function sessionKey(sessionId) {
  return `${NS}__${sessionId}`;
}

export function saveSession(sessionId, state) {
  if (!sessionId) return false;
  const payload = {
    v: 1,
    sessionId,
    savedAt: Date.now(),
    results: [...(state.allEnrichedResults || new Map()).entries()],
    enrichedKeys: [...(state.enrichedKeys || new Set())],
    exportedKeys: [...(state.exportedKeys || new Set())],
    reviewDecisions: [...(state.reviewDecisions || new Map()).entries()],
  };
  if (!writeJSON(sessionKey(sessionId), payload)) return false;
  // Update the index (most-recent-first).
  const idx = readJSON(INDEX_KEY, []);
  const filtered = idx.filter((s) => s.sessionId !== sessionId);
  filtered.unshift({ sessionId, savedAt: payload.savedAt, count: payload.results.length });
  writeJSON(INDEX_KEY, filtered.slice(0, 20));
  return true;
}

export function loadSession(sessionId) {
  if (!sessionId) return null;
  const payload = readJSON(sessionKey(sessionId), null);
  if (!payload || payload.v !== 1) return null;
  return {
    sessionId: payload.sessionId,
    savedAt: payload.savedAt,
    allEnrichedResults: new Map(payload.results || []),
    enrichedKeys: new Set(payload.enrichedKeys || []),
    exportedKeys: new Set(payload.exportedKeys || []),
    reviewDecisions: new Map(payload.reviewDecisions || []),
  };
}

export function clearSession(sessionId) {
  if (!sessionId) return;
  removeKey(sessionKey(sessionId));
  const idx = readJSON(INDEX_KEY, []);
  writeJSON(INDEX_KEY, idx.filter((s) => s.sessionId !== sessionId));
}

export function listSessions() {
  return readJSON(INDEX_KEY, []);
}

// Convenience: save with throttling — many state changes per second during a
// batch run, only one storage write per ~500ms.
export function makeThrottledSaver(getState, getSessionId, intervalMs = 500) {
  let pending = false;
  let lastFlush = 0;
  return function scheduleSave() {
    const now = Date.now();
    const sinceLast = now - lastFlush;
    if (sinceLast >= intervalMs) {
      lastFlush = now;
      const sid = typeof getSessionId === "function" ? getSessionId() : getSessionId;
      const st = typeof getState === "function" ? getState() : getState;
      if (sid) saveSession(sid, st);
      return;
    }
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      lastFlush = Date.now();
      const sid = typeof getSessionId === "function" ? getSessionId() : getSessionId;
      const st = typeof getState === "function" ? getState() : getState;
      if (sid) saveSession(sid, st);
    }, intervalMs - sinceLast);
  };
}
