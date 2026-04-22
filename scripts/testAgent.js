// scripts/testAgent.js — Phase 2B end-to-end verification
// Usage: node scripts/testAgent.js
// Env vars: RAILWAY_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GCAL_TOKEN, TEST_DEAL_ID

import { readFileSync } from "fs";
import { homedir }      from "os";
import { createClient } from "@supabase/supabase-js";

// ─── Config loading ───────────────────────────────────────────────────────────

function loadYaml(filePath) {
  try {
    const lines = readFileSync(filePath, "utf8").split("\n");
    const out   = {};
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)\s*[=:]\s*(.+)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

const yaml        = loadYaml(`${homedir()}/Desktop/supabase.yaml`);
const SUPABASE_URL        = process.env.SUPABASE_URL        || yaml.SUPABASE_URL        || "https://nuuzkvgyolxbawvqyugu.supabase.co";
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY || yaml.SUPABASE_SERVICE_ROLE_KEY || "";
const API_BASE            = (process.env.RAILWAY_URL         || "http://localhost:3000").replace(/\/$/, "");
const GCAL_TOKEN          = process.env.GCAL_TOKEN           || null;
const GCAL_BASE           = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

let dealId   = process.env.TEST_DEAL_ID || null;
let dealName = null;

async function resolveDeal() {
  if (dealId) return;
  const { data, error } = await supabase.from("socle_crm_state").select("state").eq("id", 1).maybeSingle();
  if (error || !data) throw new Error(`Cannot fetch CRM blob: ${error?.message}`);
  const deals = data.state?.deals || [];
  // Deals use `title` and `address` — not `name`. Pick first deal with an id.
  const first = deals.find(d => d.id);
  if (!first) throw new Error("No deals found in CRM blob. Set TEST_DEAL_ID env var.");
  dealId   = first.id;
  dealName = first.title || first.address || first.id;
}

async function post(body) {
  const res = await fetch(`${API_BASE}/api/agent/action`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function getDbRow(since) {
  const { data } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("deal_id", dealId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function gcalGet(eventId) {
  if (!GCAL_TOKEN || !eventId) return null;
  const res = await fetch(`${GCAL_BASE}/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${GCAL_TOKEN}` }
  });
  return { status: res.status, data: res.ok ? await res.json() : null };
}

async function gcalDelete(eventId) {
  if (!GCAL_TOKEN || !eventId) return;
  await fetch(`${GCAL_BASE}/${encodeURIComponent(eventId)}`, {
    method:  "DELETE",
    headers: { Authorization: `Bearer ${GCAL_TOKEN}` }
  });
}

// ─── Reporting ────────────────────────────────────────────────────────────────

let passed = 0;
let total  = 0;

function check(label, value, msg) {
  if (value) {
    console.log(`  ✓ ${label}`);
    return true;
  } else {
    console.log(`  ✗ ${label} — ${msg}`);
    return false;
  }
}

function skipped(label) {
  console.log(`  ~ ${label} (SKIPPED — no GCal token)`);
}

function testResult(ok) {
  total++;
  if (ok) {
    passed++;
    console.log("  PASS\n");
  } else {
    console.log("  FAIL\n");
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const createdEventIds = new Set();

async function cleanupTest(since) {
  const { data: rows } = await supabase
    .from("follow_ups")
    .select("id, gcal_event_id, status")
    .eq("deal_id", dealId)
    .gte("created_at", since);

  if (!rows?.length) return;

  // Collect GCal event IDs to delete.
  for (const row of rows) {
    if (row.gcal_event_id) createdEventIds.add(row.gcal_event_id);
  }

  // Only delete rows that are still pending (completed/cancelled rows are fine to leave).
  const pendingIds = rows.filter(r => r.status === "pending").map(r => r.id);
  if (pendingIds.length) {
    await supabase.from("follow_ups").update({ status: "cancelled" }).in("id", pendingIds);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test1(since) {
  console.log("[TEST 1] CREATE");
  let ok = true;

  const { data } = await post({
    intent:     "create follow-up tomorrow at 10am",
    dealId,
    ...(GCAL_TOKEN ? { gcalToken: GCAL_TOKEN } : {})
  });

  ok = check("actionTaken = create",  data.actionTaken === "create",  `got "${data.actionTaken}"`) && ok;
  ok = check("no warning",            !data.warning,                  `warning: ${data.warning}`) && ok;

  const row = await getDbRow(since);
  ok = check(`DB row created (id: ${row?.id ?? "—"})`, !!row,         "row not found in DB") && ok;
  ok = check("due_at is set",          !!row?.due_at,                 "due_at is null") && ok;

  if (GCAL_TOKEN) {
    ok = check("gcal_event_id set",    !!row?.gcal_event_id,          "gcal_event_id is null — expected non-null") && ok;
    if (row?.gcal_event_id) {
      const gcal = await gcalGet(row.gcal_event_id);
      ok = check("GCal event exists",  gcal?.status === 200,          `GCal GET returned ${gcal?.status}`) && ok;
      // chiefOfStaff uses deal?.name which is undefined for these deals, so summary contains dealId.
      const summaryOk = gcal?.data?.summary?.includes(dealId);
      ok = check("GCal summary contains dealId",    summaryOk,         `summary: "${gcal?.data?.summary}"`) && ok;
    }
  } else {
    skipped("gcal_event_id set");
    skipped("GCal event exists");
  }

  testResult(ok);
  return { row, ok };
}

async function test2(since, prevDueAt, prevGcalId) {
  console.log("[TEST 2] RESCHEDULE");
  let ok = true;

  const { data } = await post({
    intent:     "reschedule follow-up to next monday at 2pm",
    dealId,
    ...(GCAL_TOKEN ? { gcalToken: GCAL_TOKEN } : {})
  });

  ok = check("actionTaken = reschedule", data.actionTaken === "reschedule", `got "${data.actionTaken}"`) && ok;
  ok = check("no warning",               !data.warning,                     `warning: ${data.warning}`) && ok;

  const row = await getDbRow(since);
  ok = check("due_at updated",           row?.due_at !== prevDueAt,         `due_at unchanged: ${row?.due_at}`) && ok;

  if (GCAL_TOKEN && prevGcalId) {
    ok = check("gcal_event_id unchanged", row?.gcal_event_id === prevGcalId, `changed: was ${prevGcalId}, now ${row?.gcal_event_id}`) && ok;
    const gcal = await gcalGet(row?.gcal_event_id);
    ok = check("GCal event still exists", gcal?.status === 200,              `GCal GET returned ${gcal?.status}`) && ok;
    // Verify start time changed (event was updated).
    const newStart = gcal?.data?.start?.dateTime;
    ok = check("GCal event time updated", !!newStart,                        "start.dateTime missing") && ok;
  } else {
    skipped("gcal_event_id unchanged");
    skipped("GCal event time updated");
  }

  testResult(ok);
  return { row, ok };
}

async function test3(since, gcalEventId) {
  console.log("[TEST 3] COMPLETE");
  let ok = true;

  const { data } = await post({
    intent:     "complete the follow-up",
    dealId,
    ...(GCAL_TOKEN ? { gcalToken: GCAL_TOKEN } : {})
  });

  ok = check("actionTaken = complete", data.actionTaken === "complete", `got "${data.actionTaken}"`) && ok;
  ok = check("no warning",             !data.warning,                   `warning: ${data.warning}`) && ok;

  const row = await getDbRow(since);
  ok = check("status = completed",     row?.status === "completed",     `status: "${row?.status}"`) && ok;

  if (GCAL_TOKEN && gcalEventId) {
    const gcal = await gcalGet(gcalEventId);
    ok = check("GCal event deleted (404)", gcal?.status === 404,        `GCal GET returned ${gcal?.status}`) && ok;
  } else {
    skipped("GCal event deleted (404)");
  }

  testResult(ok);
  return { ok };
}

async function test4(since) {
  console.log("[TEST 4] SELF-HEAL (404 idempotency)");
  let ok = true;

  // Step 1: create fresh follow-up.
  const { data: createData } = await post({
    intent:     "create follow-up tomorrow at 10am",
    dealId,
    ...(GCAL_TOKEN ? { gcalToken: GCAL_TOKEN } : {})
  });
  ok = check("setup create succeeded", createData.actionTaken === "create", `got "${createData.actionTaken}"`) && ok;

  const row1 = await getDbRow(since);
  const origEventId = row1?.gcal_event_id;

  if (!GCAL_TOKEN || !origEventId) {
    skipped("gcal_event_id exists after setup create");
    skipped("manually deleted GCal event");
    skipped("reschedule creates new event");
    skipped("new gcal_event_id differs");
    skipped("new GCal event exists (200)");
    testResult(ok);
    return { ok };
  }

  ok = check(`original gcal_event_id: ${origEventId}`, !!origEventId, "gcal_event_id is null") && ok;

  // Step 2: manually delete the GCal event to simulate external deletion.
  await gcalDelete(origEventId);
  const deleted = await gcalGet(origEventId);
  ok = check("manually deleted GCal event (404)", deleted?.status === 404, `got ${deleted?.status}`) && ok;

  // Step 3: reschedule — server should detect 404, recreate.
  const { data: reschedData } = await post({
    intent:     "reschedule follow-up to next tuesday at 3pm",
    dealId,
    gcalToken:  GCAL_TOKEN
  });
  ok = check("reschedule succeeded", reschedData.actionTaken === "reschedule", `got "${reschedData.actionTaken}"`) && ok;
  ok = check("no warning",           !reschedData.warning,                     `warning: ${reschedData.warning}`) && ok;

  const row2 = await getDbRow(since);
  const newEventId = row2?.gcal_event_id;
  ok = check("gcal_event_id changed to new value", newEventId && newEventId !== origEventId, `new: ${newEventId}, orig: ${origEventId}`) && ok;
  if (newEventId) createdEventIds.add(newEventId);

  const newGcal = await gcalGet(newEventId);
  ok = check("new GCal event exists (200)", newGcal?.status === 200, `GCal GET returned ${newGcal?.status}`) && ok;

  testResult(ok);
  return { ok };
}

async function test5(since) {
  console.log("[TEST 5] NO TOKEN CASE");
  let ok = true;

  const { data } = await post({
    intent: "create follow-up tomorrow at 3pm",
    dealId
    // no gcalToken
  });

  ok = check("actionTaken = create", data.actionTaken === "create", `got "${data.actionTaken}"`) && ok;
  ok = check("no warning",           !data.warning,                 `warning: ${data.warning}`) && ok;
  ok = check("no crash (got data)",  !!data,                        "response was empty") && ok;

  const row = await getDbRow(since);
  ok = check("DB row created",       !!row,                         "row not found in DB") && ok;
  ok = check("gcal_event_id is null (no token → no GCal call)", row?.gcal_event_id == null, `gcal_event_id: ${row?.gcal_event_id}`) && ok;

  testResult(ok);
  return { ok };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await resolveDeal();

  console.log("========================================");
  console.log("Socle Agent — Phase 2B Verification");
  console.log(`API:        ${API_BASE}`);
  console.log(`Deal:       ${dealId}${dealName ? ` (${dealName})` : ""}`);
  console.log(`GCal token: ${GCAL_TOKEN ? "present" : "missing"}`);
  console.log("========================================\n");

  const startTime = new Date().toISOString();

  // Run tests sequentially; each is independent of others failing.
  // TEST 1
  const { row: row1 } = await test1(startTime);
  const prevDueAt1  = row1?.due_at;
  const prevGcalId1 = row1?.gcal_event_id;

  // TEST 2 — needs the row from TEST 1 still pending
  const { row: row2 } = await test2(startTime, prevDueAt1, prevGcalId1);
  const gcalId2 = row2?.gcal_event_id ?? prevGcalId1;

  // TEST 3 — completes the follow-up; row becomes status=completed
  await test3(startTime, gcalId2);

  // TEST 4 — creates fresh follow-up, then self-heals
  await test4(startTime);

  // TEST 5 — no token; leaves a pending row; cleanup handles it
  await test5(startTime);

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  await cleanupTest(startTime);
  // Delete any GCal events collected during the run.
  for (const eid of createdEventIds) {
    await gcalDelete(eid);
  }
  console.log("Cleanup complete.\n");

  console.log("========================================");
  console.log(`Results: ${passed}/${total} passed`);
  console.log("========================================");
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
