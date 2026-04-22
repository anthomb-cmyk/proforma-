// agent/chiefOfStaff.js — deterministic intent parsing + action dispatch.
// No LLM, no fuzzy matching.  Pattern-match only; unrecognized intents get
// a structured error, never a guess.

import {
  torontoToUtc,
  getCrmBlob,
  createFollowUp,
  rescheduleFollowUp,
  completeFollowUp,
  cancelFollowUp,
  showOverdue,
  syncFollowUpToBlob
} from "./followUpEngine.js";

// ─── Date helpers ────────────────────────────────────────────────────────────

function torontoTodayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

const WEEKDAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6
};

const MONTH_INDEX = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  janvier: 1, fevrier: 2, "février": 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, "août": 8, septembre: 9, octobre: 10, novembre: 11,
  decembre: 12, "décembre": 12
};

const WEEKDAY_PATTERN = Object.keys(WEEKDAY_INDEX).join("|");
const MONTH_PATTERN   = Object.keys(MONTH_INDEX).join("|");

// Parse a date string from natural language (EN + FR).
// Returns YYYY-MM-DD or null.
function parseDate(text) {
  const t = text.toLowerCase();
  const today = torontoTodayStr();
  const todayUtc = new Date(today + "T12:00:00Z");

  if (/\btoday\b|aujourd'?hui\b/.test(t)) return today;

  if (/\btomorrow\b|\bdemain\b/.test(t)) {
    const d = new Date(todayUtc);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // "next <weekday>" or bare "<weekday>" (both take next upcoming occurrence)
  const wdRe = new RegExp(`\\b(?:next\\s+)?(${WEEKDAY_PATTERN})\\b`, "i");
  const wdMatch = t.match(wdRe);
  if (wdMatch) {
    const target = WEEKDAY_INDEX[wdMatch[1].toLowerCase()];
    const d = new Date(todayUtc);
    let days = (target - d.getUTCDay() + 7) % 7;
    if (days === 0) days = 7; // always future
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ISO date YYYY-MM-DD
  const isoMatch = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  // "April 25" / "25 April" / "25 avril" / "avril 25"
  const mdRe = new RegExp(
    `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})\\b|\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\b`, "i"
  );
  const mdMatch = t.match(mdRe);
  if (mdMatch) {
    const monthName = (mdMatch[1] || mdMatch[4]).toLowerCase();
    const day       = parseInt(mdMatch[2] || mdMatch[3], 10);
    const month     = MONTH_INDEX[monthName];
    if (month && day >= 1 && day <= 31) {
      const year = new Date().getUTCFullYear();
      const pad  = (n) => String(n).padStart(2, "0");
      const candidate = `${year}-${pad(month)}-${pad(day)}`;
      return candidate < today ? `${year + 1}-${pad(month)}-${pad(day)}` : candidate;
    }
  }

  return null;
}

// Parse a time string from natural language (EN + FR).
// Returns HH:MM (24h) or null.
function parseTime(text) {
  const t = text.toLowerCase();

  // 3:30pm / 3pm
  const pmColon = t.match(/\b(\d{1,2}):(\d{2})\s*pm\b/);
  if (pmColon) return `${String(parseInt(pmColon[1], 10) % 12 + 12).padStart(2, "0")}:${pmColon[2]}`;

  const pmSimple = t.match(/\b(\d{1,2})\s*pm\b/);
  if (pmSimple) return `${String(parseInt(pmSimple[1], 10) % 12 + 12).padStart(2, "0")}:00`;

  // 3:30am / 3am
  const amColon = t.match(/\b(\d{1,2}):(\d{2})\s*am\b/);
  if (amColon) return `${String(parseInt(amColon[1], 10) % 12).padStart(2, "0")}:${amColon[2]}`;

  const amSimple = t.match(/\b(\d{1,2})\s*am\b/);
  if (amSimple) return `${String(parseInt(amSimple[1], 10) % 12).padStart(2, "0")}:00`;

  // 15h30 / 15h (French style)
  const frTime = t.match(/\b(\d{1,2})h(\d{2})?\b/);
  if (frTime) {
    const h = parseInt(frTime[1], 10);
    if (h < 24) return `${String(h).padStart(2, "0")}:${frTime[2] || "00"}`;
  }

  // 15:00 (military, no am/pm)
  const mil = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (mil) {
    const h = parseInt(mil[1], 10);
    if (h < 24) return `${String(h).padStart(2, "0")}:${mil[2]}`;
  }

  return null;
}

// ─── Intent parser ────────────────────────────────────────────────────────────
// Returns { action, params, error? }.

function parseIntent(intentStr, dealId = null) {
  const t = (intentStr || "").trim();

  // show_overdue — check before create/complete to avoid "show" ambiguity
  if (
    /\b(show|list|get|find|display|afficher|montrer|lister|trouver)\b.*(\b(overdue|late|missed|expired)\b|en\s+retard)/i.test(t) ||
    /\b(overdue|late|missed)\b.*\b(follow.?up|suivi)/i.test(t) ||
    /en\s+retard\b.*\b(follow.?up|suivi)/i.test(t) ||
    /\boverdue\b/i.test(t) ||
    /\ben\s+retard\b/i.test(t)
  ) {
    return { action: "show_overdue", params: { dealId: dealId || null } };
  }

  // complete
  if (
    /\b(complete|done|finish|close|mark.*done|marquer.*fait)\b.*\bfollow.?up\b/i.test(t) ||
    /\bfollow.?up\b.*\b(done|complete|finished|fait)\b/i.test(t)
  ) {
    return { action: "complete", params: { dealId: dealId || null } };
  }

  // cancel
  if (
    /\b(cancel|remove|delete|annul|clear|supprimer|annuler)\b.*\bfollow.?up\b/i.test(t) ||
    /\bfollow.?up\b.*\b(cancel|remove|delete|annul)\b/i.test(t)
  ) {
    return { action: "cancel", params: { dealId: dealId || null } };
  }

  // reschedule — must come before create
  if (
    /\b(reschedule|move|push|déplacer|remettre|reporter)\b.*\bfollow.?up\b/i.test(t) ||
    /\bfollow.?up\b.*\b(reschedule|move|push|déplacer)\b/i.test(t)
  ) {
    return { action: "reschedule", params: { dealId: dealId || null, date: parseDate(t), time: parseTime(t) } };
  }

  // create
  if (
    /\b(create|add|schedule|set|book|ajouter|créer|planifier)\b.*\bfollow.?up\b/i.test(t) ||
    /\bfollow.?up\b.*\b(create|add|schedule|set|book)\b/i.test(t)
  ) {
    const noteMatch = t.match(/(?:note\s*[:\-]\s*|with note\s+)(.*)/i);
    return {
      action: "create",
      params: {
        dealId: dealId || null,
        date: parseDate(t),
        time: parseTime(t),
        note: noteMatch ? noteMatch[1].trim() : null
      }
    };
  }

  return {
    action: "unknown",
    params: {},
    error: `Intent not recognized: "${t.slice(0, 80)}". Supported: create, reschedule, complete, cancel, show_overdue.`
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatch(supabase, { intent, dealId }) {
  const parsed = parseIntent(intent, dealId);

  if (parsed.action === "unknown") {
    return {
      actionTaken: "none",
      followUpChanges: null,
      shortExplanation: parsed.error
    };
  }

  const { action, params } = parsed;

  // Resolve deal name once for richer explanations.
  let dealLabel = params.dealId || "unknown deal";
  if (params.dealId) {
    const { blob } = await getCrmBlob(supabase);
    const deal = (blob?.deals || []).find(d => d.id === params.dealId);
    if (deal?.name) dealLabel = deal.name;
  }

  // ── show_overdue ──────────────────────────────────────────────────────────
  if (action === "show_overdue") {
    const result = await showOverdue(supabase, { dealId: params.dealId });
    if (!result.ok) {
      return { actionTaken: "show_overdue", followUpChanges: null, shortExplanation: `Error: ${result.error}` };
    }
    const count = result.data?.length ?? 0;
    const scope = params.dealId ? `for ${dealLabel}` : "globally";
    return {
      actionTaken: "show_overdue",
      followUpChanges: result.data,
      shortExplanation: count === 0
        ? `No overdue follow-ups ${scope}.`
        : `${count} overdue follow-up${count !== 1 ? "s" : ""} ${scope}.`
    };
  }

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    if (!params.dealId) {
      return { actionTaken: "none", followUpChanges: null, shortExplanation: "dealId is required to create a follow-up. Pass it in the request body." };
    }
    if (!params.date) {
      return { actionTaken: "none", followUpChanges: null, shortExplanation: "Could not parse a date. Try: 'create follow-up for deal X tomorrow at 3pm'." };
    }
    const dueAt = torontoToUtc(params.date, params.time);
    const result = await createFollowUp(supabase, { dealId: params.dealId, dueAt, note: params.note });
    if (!result.ok) {
      return { actionTaken: "create", followUpChanges: null, shortExplanation: `Error: ${result.error}` };
    }
    await syncFollowUpToBlob(supabase, { dealId: params.dealId, dueAt: result.data.due_at });
    const timeLabel = params.time ? ` at ${params.time}` : "";
    return {
      actionTaken: "create",
      followUpChanges: result.data,
      shortExplanation: `Follow-up created for ${dealLabel} on ${params.date}${timeLabel}.`
    };
  }

  // ── reschedule ────────────────────────────────────────────────────────────
  if (action === "reschedule") {
    if (!params.dealId) {
      return { actionTaken: "none", followUpChanges: null, shortExplanation: "dealId is required to reschedule a follow-up." };
    }
    if (!params.date) {
      return { actionTaken: "none", followUpChanges: null, shortExplanation: "Could not parse a new date. Try: 'reschedule follow-up for deal X to next Tuesday at 2pm'." };
    }
    const dueAt = torontoToUtc(params.date, params.time);
    const result = await rescheduleFollowUp(supabase, { dealId: params.dealId, dueAt });
    if (!result.ok) {
      return { actionTaken: "reschedule", followUpChanges: null, shortExplanation: `Error: ${result.error}` };
    }
    await syncFollowUpToBlob(supabase, { dealId: params.dealId, dueAt: result.data.due_at });
    const timeLabel = params.time ? ` at ${params.time}` : "";
    return {
      actionTaken: "reschedule",
      followUpChanges: result.data,
      shortExplanation: `Follow-up for ${dealLabel} rescheduled to ${params.date}${timeLabel}.`
    };
  }

  // ── complete ──────────────────────────────────────────────────────────────
  if (action === "complete") {
    if (!params.dealId) {
      return { actionTaken: "none", followUpChanges: null, shortExplanation: "dealId is required to complete a follow-up." };
    }
    const result = await completeFollowUp(supabase, { dealId: params.dealId });
    if (!result.ok) {
      return { actionTaken: "complete", followUpChanges: null, shortExplanation: `Error: ${result.error}` };
    }
    await syncFollowUpToBlob(supabase, { dealId: params.dealId, dueAt: null });
    return {
      actionTaken: "complete",
      followUpChanges: result.data,
      shortExplanation: `Follow-up for ${dealLabel} marked as completed.`
    };
  }

  // ── cancel ────────────────────────────────────────────────────────────────
  if (action === "cancel") {
    if (!params.dealId) {
      return { actionTaken: "none", followUpChanges: null, shortExplanation: "dealId is required to cancel a follow-up." };
    }
    const result = await cancelFollowUp(supabase, { dealId: params.dealId });
    if (!result.ok) {
      return { actionTaken: "cancel", followUpChanges: null, shortExplanation: `Error: ${result.error}` };
    }
    await syncFollowUpToBlob(supabase, { dealId: params.dealId, dueAt: null });
    return {
      actionTaken: "cancel",
      followUpChanges: result.data,
      shortExplanation: `Follow-up for ${dealLabel} cancelled.`
    };
  }

  return { actionTaken: "none", followUpChanges: null, shortExplanation: "Unhandled action — this is a bug." };
}
