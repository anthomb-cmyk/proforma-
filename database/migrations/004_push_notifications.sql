-- Migration 004: push notification infrastructure
-- Run once in Supabase SQL editor or via MCP apply_migration.

-- 1. Device push-subscription registry.
--    Endpoint is unique per device/browser; re-subscribing on the same device
--    upserts rather than duplicating.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          bigserial   PRIMARY KEY,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  user_id     text,
  user_name   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

-- 2. Track when scanAndNotify() last fired for each pending follow-up.
--    Enforces a 60-minute dedup window: a row that stays overdue for hours
--    re-notifies at most once per hour (intentional reminder cadence).
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;
