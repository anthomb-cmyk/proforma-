// proforma-web/src/lib/neverCallList.js
//
// Local deny-list for phones / owners the user has explicitly rejected.
// Two indexes — phone digits and a normalized owner-key — so the same entry
// is matchable from either direction. Used by the review queue's "Reject"
// action and by export-to-Leads to skip rejected items.
//
// Persisted to localStorage so the list survives across sessions and across
// re-imports of an updated rôle file.

const KEY = "pf_never_call_list_v1";

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readState() {
  const ls = safeStorage();
  if (!ls) return { byPhone: {}, byOwner: {} };
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return { byPhone: {}, byOwner: {} };
    const parsed = JSON.parse(raw);
    return {
      byPhone: parsed?.byPhone || {},
      byOwner: parsed?.byOwner || {},
    };
  } catch {
    return { byPhone: {}, byOwner: {} };
  }
}

function writeState(state) {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    ls.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ─── Key normalization ───────────────────────────────────────────────────

export function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D+/g, "");
}

export function normalizeOwnerKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Public API ──────────────────────────────────────────────────────────

export function isNeverCall({ phone, ownerName } = {}) {
  const state = readState();
  const pd = normalizePhoneDigits(phone);
  const ok = normalizeOwnerKey(ownerName);
  if (pd && state.byPhone[pd]) return true;
  if (ok && state.byOwner[ok]) return true;
  return false;
}

export function markNeverCall({ phone, ownerName, reason } = {}) {
  const state = readState();
  const pd = normalizePhoneDigits(phone);
  const ok = normalizeOwnerKey(ownerName);
  const at = Date.now();
  if (pd) state.byPhone[pd] = { reason: reason || "rejected", at };
  if (ok) state.byOwner[ok] = { reason: reason || "rejected", at };
  return writeState(state);
}

export function unmarkNeverCall({ phone, ownerName } = {}) {
  const state = readState();
  const pd = normalizePhoneDigits(phone);
  const ok = normalizeOwnerKey(ownerName);
  let changed = false;
  if (pd && state.byPhone[pd]) { delete state.byPhone[pd]; changed = true; }
  if (ok && state.byOwner[ok]) { delete state.byOwner[ok]; changed = true; }
  if (changed) writeState(state);
  return changed;
}

export function listNeverCall() {
  const state = readState();
  const phones = Object.entries(state.byPhone).map(([digits, meta]) => ({
    kind: "phone",
    digits,
    reason: meta?.reason || "",
    at: meta?.at || 0,
  }));
  const owners = Object.entries(state.byOwner).map(([key, meta]) => ({
    kind: "owner",
    ownerKey: key,
    reason: meta?.reason || "",
    at: meta?.at || 0,
  }));
  return [...phones, ...owners].sort((a, b) => b.at - a.at);
}

export function clearNeverCallList() {
  const ls = safeStorage();
  if (!ls) return;
  try { ls.removeItem(KEY); } catch {}
}
