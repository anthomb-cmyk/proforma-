// Server-backed sync for the shared CRM state (owners / deals / leads /
// flags / currentId / gcalOk). The localStorage `acq_crm_v4` key remains
// as an offline cache and an initial hydration source; the server holds
// the canonical shared copy for the team.
//
// Conflict policy: last-write-wins. With two users on a small internal
// tool this is acceptable — simultaneous edits on the same record are
// vanishingly rare. Upgrade to per-record updated_at checks later if
// needed.
//
// All functions fail soft: if the server is unreachable or returns an
// error, the client keeps working off local state. The UI never blocks
// on a network round-trip.

const ENDPOINT = "/api/crm/state";

export async function fetchServerState() {
  try {
    const r = await fetch(ENDPOINT, { method: "GET" });
    if (!r.ok) return { ok: false, state: null, error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => ({}));
    if (!data.ok) return { ok: false, state: null, error: data.error || "Unknown" };
    return { ok: true, state: data.state || null, updated_at: data.updated_at || null };
  } catch (err) {
    return { ok: false, state: null, error: err?.message || "network" };
  }
}

// Fire-and-forget push. Returns a promise for callers that want to wait,
// but errors are swallowed so bad network conditions never throw.
export async function pushServerState(state) {
  try {
    const r = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => ({}));
    return data.ok ? { ok: true, updated_at: data.updated_at } : { ok: false, error: data.error };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}
