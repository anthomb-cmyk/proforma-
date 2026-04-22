// agent/followUpEngine.js — follow-up CRUD against Supabase.
// All functions accept the supabaseServerClient from server.js and return
// { ok: bool, data: any, error: string|null }.

// Mirrors the version in server.js — kept local to avoid importing server.js.
export function torontoToUtc(dateStr, timeStr) {
  const time = ((timeStr || "").trim() || "09:00");
  const fakeUtc = new Date(`${dateStr}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  const parts = fmt.formatToParts(fakeUtc);
  const g = (type) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const torMs = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return new Date(fakeUtc.getTime() + (fakeUtc.getTime() - torMs)).toISOString();
}

// Fetch the full CRM blob (deals array).
export async function getCrmBlob(supabase) {
  try {
    const { data, error } = await supabase
      .from("socle_crm_state")
      .select("state")
      .eq("id", 1)
      .maybeSingle();
    if (error) return { ok: false, blob: null, error: error.message };
    return { ok: true, blob: data?.state || {}, error: null };
  } catch (err) {
    return { ok: false, blob: null, error: err?.message || "getCrmBlob failed" };
  }
}

// Create a follow-up for a deal.  If a pending one already exists for that
// dealId, update it in-place (upsert semantics: user said "create" and we
// honour the intent without requiring a cancel step first).
export async function createFollowUp(supabase, { dealId, contactId = null, dueAt, note = null }) {
  try {
    // Check for existing pending follow-up on this deal.
    const { data: existing, error: fetchErr } = await supabase
      .from("follow_ups")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "pending")
      .maybeSingle();

    if (fetchErr) return { ok: false, data: null, error: fetchErr.message };

    if (existing) {
      // Update the existing pending row.
      const updateFields = { due_at: dueAt };
      if (note !== null) updateFields.note = note;
      const { data, error } = await supabase
        .from("follow_ups")
        .update(updateFields)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) return { ok: false, data: null, error: error.message };
      return { ok: true, data, error: null };
    }

    // Insert fresh row.
    const { data, error } = await supabase
      .from("follow_ups")
      .insert({ deal_id: dealId, contact_id: contactId, due_at: dueAt, note, status: "pending" })
      .select()
      .single();
    if (error) return { ok: false, data: null, error: error.message };
    return { ok: true, data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || "createFollowUp failed" };
  }
}

// Move a pending follow-up to a new due_at.  Looks up by dealId.
export async function rescheduleFollowUp(supabase, { dealId, dueAt }) {
  try {
    const { data, error } = await supabase
      .from("follow_ups")
      .update({ due_at: dueAt })
      .eq("deal_id", dealId)
      .eq("status", "pending")
      .select()
      .single();
    if (error) {
      if (error.code === "PGRST116") {
        return { ok: false, data: null, error: `No pending follow-up found for deal ${dealId}.` };
      }
      return { ok: false, data: null, error: error.message };
    }
    return { ok: true, data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || "rescheduleFollowUp failed" };
  }
}

// Mark the pending follow-up for a deal as completed.
export async function completeFollowUp(supabase, { dealId }) {
  try {
    const { data, error } = await supabase
      .from("follow_ups")
      .update({ status: "completed" })
      .eq("deal_id", dealId)
      .eq("status", "pending")
      .select()
      .single();
    if (error) {
      if (error.code === "PGRST116") {
        return { ok: false, data: null, error: `No pending follow-up found for deal ${dealId}.` };
      }
      return { ok: false, data: null, error: error.message };
    }
    return { ok: true, data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || "completeFollowUp failed" };
  }
}

// Cancel (soft-delete) the pending follow-up for a deal.
export async function cancelFollowUp(supabase, { dealId }) {
  try {
    const { data, error } = await supabase
      .from("follow_ups")
      .update({ status: "cancelled" })
      .eq("deal_id", dealId)
      .eq("status", "pending")
      .select()
      .single();
    if (error) {
      if (error.code === "PGRST116") {
        return { ok: false, data: null, error: `No pending follow-up found for deal ${dealId}.` };
      }
      return { ok: false, data: null, error: error.message };
    }
    return { ok: true, data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || "cancelFollowUp failed" };
  }
}

// List all overdue pending follow-ups (due_at < now, status = pending).
// Optionally scoped to a single dealId.  Each row is enriched with dealName
// resolved from the CRM blob (null when the deal is not in the blob).
export async function showOverdue(supabase, { dealId = null } = {}) {
  try {
    const now = new Date().toISOString();
    let query = supabase
      .from("follow_ups")
      .select("*")
      .eq("status", "pending")
      .lt("due_at", now)
      .order("due_at", { ascending: true });

    if (dealId) query = query.eq("deal_id", dealId);

    const { data, error } = await query;
    if (error) return { ok: false, data: null, error: error.message };

    const rows = data || [];
    if (rows.length > 0) {
      const { blob } = await getCrmBlob(supabase);
      const nameMap = {};
      for (const d of (blob?.deals || [])) nameMap[d.id] = d.name || null;
      for (const row of rows) row.dealName = nameMap[row.deal_id] ?? null;
    }

    return { ok: true, data: rows, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || "showOverdue failed" };
  }
}

// Mirror a follow-up mutation into the CRM blob so the frontend stays in sync.
// dueAt: UTC ISO string → sets followUpDate + followUpTime on the deal.
// dueAt: null           → clears followUpDate and followUpTime (complete/cancel).
// Silently no-ops when the dealId is not found in the blob (deal may not exist yet).
// Failure is non-fatal — the follow_ups table write already succeeded.
export async function syncFollowUpToBlob(supabase, { dealId, dueAt }) {
  try {
    const { data, error: fetchErr } = await supabase
      .from("socle_crm_state")
      .select("state")
      .eq("id", 1)
      .maybeSingle();
    if (fetchErr) return { ok: false, error: fetchErr.message };

    const blob  = data?.state || {};
    const deals = Array.isArray(blob.deals) ? [...blob.deals] : [];
    const idx   = deals.findIndex(d => d.id === dealId);
    if (idx === -1) return { ok: true, skipped: true };

    if (dueAt) {
      // Convert UTC → Toronto local date + time for the blob fields.
      const d    = new Date(String(dueAt).replace(" ", "T"));
      const fmt  = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
        hour12: false
      });
      const parts = fmt.formatToParts(d);
      const g     = (type) => parts.find(p => p.type === type)?.value ?? "";
      const h     = g("hour") === "24" ? "00" : g("hour");
      deals[idx] = { ...deals[idx], followUpDate: `${g("year")}-${g("month")}-${g("day")}`, followUpTime: `${h}:${g("minute")}` };
    } else {
      deals[idx] = { ...deals[idx], followUpDate: "", followUpTime: "" };
    }

    const { error: writeErr } = await supabase
      .from("socle_crm_state")
      .update({ state: { ...blob, deals }, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (writeErr) return { ok: false, error: writeErr.message };
    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, error: err?.message || "syncFollowUpToBlob failed" };
  }
}

// Append a record to communication_events for every agent action.
// Non-fatal: any error is console.error'd and swallowed.
export async function logAgentAction(supabase, { dealId, contactId, action, intent, shortExplanation }) {
  try {
    await supabase.from("communication_events").insert({
      deal_id:    dealId    || null,
      contact_id: contactId || null,
      channel:    "agent",
      direction:  "internal",
      content:    shortExplanation,
      metadata:   { action, intent },
      occurred_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("[logAgentAction]", err?.message);
  }
}
