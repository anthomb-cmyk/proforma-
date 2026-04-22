// agent/gcalSync.js — Google Calendar sync helpers for follow-up mutations.
// All functions return { ok: bool, eventId?: string, error?: string }.
// Token is a raw Bearer token string (OAuth access token).

const GCAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function buildEventBody(summary, description, startUtc) {
  const endUtc = new Date(new Date(startUtc).getTime() + 30 * 60 * 1000).toISOString();
  return {
    summary,
    description: description || "",
    start: { dateTime: startUtc, timeZone: "America/Toronto" },
    end:   { dateTime: endUtc,   timeZone: "America/Toronto" }
  };
}

// Create a new GCal event. Returns { ok, eventId }.
export async function createEvent(token, { summary, description, dueAtUtc }) {
  if (!token) return { ok: false, error: "No GCal token" };
  try {
    const res = await fetch(GCAL_BASE, {
      method:  "POST",
      headers: authHeader(token),
      body:    JSON.stringify(buildEventBody(summary, description, dueAtUtc))
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `GCal create ${res.status}: ${text.slice(0, 120)}` };
    }
    const event = await res.json();
    return { ok: true, eventId: event.id };
  } catch (err) {
    return { ok: false, error: err?.message || "createEvent failed" };
  }
}

// Upsert a GCal event: PATCH if gcalEventId is set, create if null or 404.
// Returns { ok, eventId }.
export async function upsertEvent(token, gcalEventId, { summary, description, dueAtUtc }) {
  if (!token) return { ok: false, error: "No GCal token" };

  if (gcalEventId) {
    try {
      const res = await fetch(`${GCAL_BASE}/${encodeURIComponent(gcalEventId)}`, {
        method:  "PATCH",
        headers: authHeader(token),
        body:    JSON.stringify(buildEventBody(summary, description, dueAtUtc))
      });
      if (res.status === 404) {
        // Event was deleted externally — fall through to create.
      } else if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `GCal patch ${res.status}: ${text.slice(0, 120)}` };
      } else {
        const event = await res.json();
        return { ok: true, eventId: event.id };
      }
    } catch (err) {
      return { ok: false, error: err?.message || "upsertEvent patch failed" };
    }
  }

  // Create new event (gcalEventId was null, or 404 fell through).
  return createEvent(token, { summary, description, dueAtUtc });
}

// Delete a GCal event. 404 is treated as success (already gone).
// Returns { ok }.
export async function deleteEvent(token, gcalEventId) {
  if (!token || !gcalEventId) return { ok: true };
  try {
    const res = await fetch(`${GCAL_BASE}/${encodeURIComponent(gcalEventId)}`, {
      method:  "DELETE",
      headers: authHeader(token)
    });
    if (res.status === 404 || res.status === 204 || res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, error: `GCal delete ${res.status}: ${text.slice(0, 120)}` };
  } catch (err) {
    return { ok: false, error: err?.message || "deleteEvent failed" };
  }
}
