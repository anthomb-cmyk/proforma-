// services/callLogsStore.js
//
// Supabase-backed store for Twilio call logs. Replaces the old
// .data/call-logs.json helper pair which was wiped on every Railway deploy.
//
// Design notes:
//
//   * The module is lazily configured via `configureCallLogsStore({ supabase })`
//     at server boot. If Supabase credentials aren't available, it falls back
//     to an in-memory array so local dev and tests still work.
//
//   * Public API mirrors the old helpers so existing call sites in server.js
//     keep working without edits:
//        loadCallLogs()                    → full array, newest-first, up to 500 rows
//        saveCallLogs(callLogs)            → bulk upsert
//     Plus a per-row write that's safer under concurrent webhook load:
//        upsertCallLog(callLog)            → single-row insert-or-update
//        updateCallLog(id, patch)          → single-row partial update
//        findCallLogById(id)
//        findCallLogByCallSid(callSid)
//        getCallLogsByDealId(dealId)
//
//   * Every async call swallows Supabase errors and logs a warning — we
//     never want a transient DB error to crash the webhook handler that
//     Twilio expects to 2xx quickly. Callers should treat a falsy return
//     as "lookup failed / not found".
//
//   * Race safety: the old pattern of loadCallLogs → mutate → saveCallLogs
//     is race-prone because two webhooks can each load, one of them writes,
//     then the second writes and clobbers the first's mutation. The webhook
//     handlers should migrate to updateCallLog(id, patch) over time; this
//     module provides that primitive even though load/save are still
//     exported for backward compat.

const TABLE_NAME = "call_logs";

let _supabase = null;
let _memory = []; // used when _supabase is null

function now() {
  return new Date().toISOString();
}

function sortDesc(rows) {
  return [...rows].sort((a, b) => {
    const tb = new Date(b.created_at || 0).getTime();
    const ta = new Date(a.created_at || 0).getTime();
    return tb - ta;
  });
}

export function configureCallLogsStore({ supabase = null, initialMemory = [] } = {}) {
  _supabase = supabase;
  _memory = Array.isArray(initialMemory) ? [...initialMemory] : [];
}

export function isCallLogsStoreBacked() {
  return Boolean(_supabase);
}

export async function loadCallLogs() {
  if (_supabase) {
    const { data, error } = await _supabase
      .from(TABLE_NAME)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.warn("[callLogsStore:loadCallLogs]", error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  }
  return sortDesc(_memory);
}

export async function saveCallLogs(callLogs) {
  if (!Array.isArray(callLogs)) return;
  if (_supabase) {
    if (!callLogs.length) return;
    // Stamp updated_at so Supabase upsert doesn't silently let a stale
    // copy reset the timestamp to its older value.
    const stamped = callLogs.map((log) => ({ ...log, updated_at: log.updated_at || now() }));
    const { error } = await _supabase
      .from(TABLE_NAME)
      .upsert(stamped, { onConflict: "id" });
    if (error) {
      console.warn("[callLogsStore:saveCallLogs]", error.message);
    }
    return;
  }
  _memory = [...callLogs];
}

export async function upsertCallLog(callLog) {
  if (!callLog || typeof callLog !== "object" || !callLog.id) return null;
  const stamped = { ...callLog, updated_at: now() };
  if (_supabase) {
    const { data, error } = await _supabase
      .from(TABLE_NAME)
      .upsert(stamped, { onConflict: "id" })
      .select()
      .maybeSingle();
    if (error) {
      console.warn("[callLogsStore:upsertCallLog]", error.message);
      return null;
    }
    return data || stamped;
  }
  const idx = _memory.findIndex((l) => String(l.id) === String(stamped.id));
  if (idx >= 0) {
    _memory[idx] = { ..._memory[idx], ...stamped };
    return _memory[idx];
  }
  _memory.unshift(stamped);
  return stamped;
}

export async function updateCallLog(id, patch) {
  if (!id || !patch || typeof patch !== "object") return null;
  const withTs = { ...patch, updated_at: now() };
  if (_supabase) {
    const { data, error } = await _supabase
      .from(TABLE_NAME)
      .update(withTs)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) {
      console.warn("[callLogsStore:updateCallLog]", error.message);
      return null;
    }
    return data || null;
  }
  const idx = _memory.findIndex((l) => String(l.id) === String(id));
  if (idx < 0) return null;
  _memory[idx] = { ..._memory[idx], ...withTs };
  return _memory[idx];
}

export async function findCallLogById(id) {
  if (!id) return null;
  if (_supabase) {
    const { data, error } = await _supabase
      .from(TABLE_NAME)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      // maybeSingle returns an error with code PGRST116 when no row matches.
      // Treat that as "not found" — don't log.
      if (error.code !== "PGRST116") {
        console.warn("[callLogsStore:findCallLogById]", error.message);
      }
      return null;
    }
    return data || null;
  }
  return _memory.find((l) => String(l.id) === String(id)) || null;
}

export async function findCallLogByCallSid(callSid) {
  if (!callSid) return null;
  const needle = String(callSid);
  if (_supabase) {
    // Check both call_sid and parent_call_sid — Twilio's status callback for
    // the child leg has its own CallSid but the log we care about was created
    // against the parent.
    const { data, error } = await _supabase
      .from(TABLE_NAME)
      .select("*")
      .or(`call_sid.eq.${needle},parent_call_sid.eq.${needle}`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.warn("[callLogsStore:findCallLogByCallSid]", error.message);
      return null;
    }
    return (data && data[0]) || null;
  }
  return (
    _memory.find((l) => String(l.call_sid) === needle) ||
    _memory.find((l) => String(l.parent_call_sid) === needle) ||
    null
  );
}

export async function getCallLogsByDealId(dealId) {
  if (!dealId) return [];
  const needle = String(dealId);
  if (_supabase) {
    const { data, error } = await _supabase
      .from(TABLE_NAME)
      .select("*")
      .eq("deal_id", needle)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[callLogsStore:getCallLogsByDealId]", error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  }
  return sortDesc(_memory.filter((l) => String(l.deal_id || "") === needle));
}

// One-shot seeder. On boot, after configureCallLogsStore has attached a
// Supabase client, call this with the rows parsed from the legacy JSON file
// (if any). Uses upsert onConflict=id so it's idempotent — you can call it
// on every boot without creating duplicates.
export async function seedFromLegacyFile(rows) {
  if (!_supabase) return { skipped: true, reason: "no-supabase-client" };
  if (!Array.isArray(rows) || !rows.length) {
    return { skipped: true, reason: "no-rows-to-migrate" };
  }
  const stamped = rows.map((row) => ({
    ...row,
    // Defensive: migration 005 requires deal_id not null; old JSON sometimes
    // had null for inbound-only rows.
    deal_id: row.deal_id || "",
    events: Array.isArray(row.events) ? row.events : [],
    updated_at: row.updated_at || now(),
    created_at: row.created_at || now(),
  }));
  const { error } = await _supabase
    .from(TABLE_NAME)
    .upsert(stamped, { onConflict: "id", ignoreDuplicates: false });
  if (error) {
    console.warn("[callLogsStore:seedFromLegacyFile]", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, count: stamped.length };
}
