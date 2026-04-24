-- Migration 005: promote call_logs to primary store (replaces .data/call-logs.json).
--
-- Background: call history was living in a JSON file on Railway's ephemeral
-- filesystem. Every deploy wiped it — and Twilio recording webhooks arriving
-- mid-deploy had nowhere to write to. This migration converts the existing
-- lightweight `call_logs` mirror table (from migration 002) into the primary
-- store so records survive deploys.
--
-- Idempotent: safe to re-run. All column additions use IF NOT EXISTS.

-- 1) Server-supplied IDs are "call_<ts>_<random>" strings, not UUIDs. Drop
--    the uuid default and retype to text. Existing rows (if any) are cast
--    to text via their canonical uuid representation.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'call_logs'
      and column_name  = 'id'
      and data_type    = 'uuid'
  ) then
    alter table public.call_logs alter column id drop default;
    alter table public.call_logs alter column id type text using id::text;
  end if;
end $$;

-- 2) Add every column the server persists. Missing columns are added with
--    sensible defaults so older rows (if any) stay queryable.
alter table public.call_logs
  add column if not exists deal_id           text        not null default '',
  add column if not exists lead_name         text,
  add column if not exists deal_title        text,
  add column if not exists "from"            text,
  add column if not exists "to"              text,
  add column if not exists call_sid          text,
  add column if not exists parent_call_sid   text,
  add column if not exists status            text,
  add column if not exists duration_seconds  integer,
  add column if not exists recording_sid     text,
  add column if not exists recording_url     text,
  add column if not exists transcript        text,
  add column if not exists transcript_status text,
  add column if not exists transcript_error  text,
  add column if not exists events            jsonb       not null default '[]'::jsonb,
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists updated_at        timestamptz not null default now();

-- 3) Lookup indexes for the hot webhook paths. Partial indexes skip rows
--    that don't have the value set (avoids index bloat from inbound-only
--    calls that have no parent_call_sid, etc.).
create index if not exists call_logs_deal_id_idx
  on public.call_logs (deal_id)
  where deal_id <> '';

create index if not exists call_logs_call_sid_idx
  on public.call_logs (call_sid)
  where call_sid is not null;

create index if not exists call_logs_parent_call_sid_idx
  on public.call_logs (parent_call_sid)
  where parent_call_sid is not null;

create index if not exists call_logs_created_at_desc_idx
  on public.call_logs (created_at desc);

-- 4) Row-level security is enforced at the API layer (service-role key
--    bypasses RLS). Keep RLS disabled here so the server can write freely
--    and no anonymous client ever reaches this table directly.
alter table public.call_logs disable row level security;

comment on table public.call_logs is
  'Primary store for Twilio call logs (status, recording URL, Whisper transcript, event stream). Previously stored in .data/call-logs.json, wiped on every Railway deploy.';
