// agent/pushNotifier.js — Scheduled follow-up push notification scanner.
//
// Reads from the follow_ups table every 5 minutes, sends web-push notifications
// for rows that are due (within ±5 min of now) or overdue (> 5 min past due).
// Uses last_notified_at for a 60-minute dedup window so a persistently-overdue
// follow-up re-notifies at most once per hour.
//
// Usage (in server.js after push and Supabase are configured):
//   import { startPushNotifier } from "./agent/pushNotifier.js";
//   const notifier = startPushNotifier(supabaseServerClient, dispatchPush);
//   // notifier.scanAndNotify() — call directly for immediate test
//   // notifier.stop()          — stop the interval (graceful shutdown)

const INTERVAL_MS   = 5 * 60 * 1000;   // 5 minutes
const DUE_WINDOW_MS = 5 * 60 * 1000;   // ±5 min = "due now"
const DEDUP_MS      = 60 * 60 * 1000;  // 60-min dedup window

export function startPushNotifier(supabase, dispatchPushFn) {
  async function scanAndNotify() {
    try {
      const now          = new Date();
      const fiveMinAhead = new Date(now.getTime() + DUE_WINDOW_MS).toISOString();
      const sixtyMinAgo  = new Date(now.getTime() - DEDUP_MS).toISOString();

      // All pending follow-ups due now or already past.
      const { data: rows, error } = await supabase
        .from("follow_ups")
        .select("id, deal_id, due_at, last_notified_at")
        .eq("status", "pending")
        .lt("due_at", fiveMinAhead);

      if (error) { console.warn("[pushNotifier] fetch error:", error.message); return; }
      if (!rows?.length) return;

      // Enforce dedup: skip rows notified within the last 60 minutes.
      const candidates = rows.filter(row =>
        !row.last_notified_at || row.last_notified_at < sixtyMinAgo
      );
      if (!candidates.length) return;

      // Resolve deal names from CRM blob (single fetch, shared across all rows).
      const { data: stateRow } = await supabase
        .from("socle_crm_state")
        .select("state")
        .eq("id", 1)
        .maybeSingle();
      const nameMap = {};
      for (const d of (stateRow?.state?.deals || [])) {
        nameMap[d.id] = d.title || d.name || null;
      }

      for (const row of candidates) {
        const diffMin  = Math.round((now.getTime() - new Date(row.due_at).getTime()) / 60000);
        const isOverdue = diffMin > 5;
        const dealName  = nameMap[row.deal_id] || row.deal_id;

        await dispatchPushFn({ all: true }, {
          title:               `Suivi : ${dealName}`,
          body:                isOverdue ? "Ce suivi est en retard." : "Ce suivi est dû maintenant.",
          url:                 `/?deal=${encodeURIComponent(row.deal_id)}`,
          tag:                 `followup-${row.id}`,
          requireInteraction:  true,
          renotify:            isOverdue,
        });

        await supabase
          .from("follow_ups")
          .update({ last_notified_at: now.toISOString() })
          .eq("id", row.id);

        console.log(
          `[pushNotifier] sent ${isOverdue ? "overdue" : "due-now"} notification` +
          ` for follow-up ${row.id} (${dealName})`
        );
      }
    } catch (err) {
      console.error("[pushNotifier] scanAndNotify crash:", err?.message);
    }
  }

  // Fire immediately on startup so the first scan doesn't wait 5 minutes.
  scanAndNotify();
  const intervalId = setInterval(scanAndNotify, INTERVAL_MS);

  return {
    scanAndNotify,
    stop: () => clearInterval(intervalId),
  };
}
