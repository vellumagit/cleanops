-- =============================================================================
-- Self-managed trial reminder dedup key on organizations
-- =============================================================================
-- The trial-expiring cron handles two trial systems:
--   1. Stripe-managed trials — deduped via subscriptions.last_event_id
--   2. Self-managed trials  — orgs with trial_started_at set directly
--      (no Stripe subscription yet); deduped via THIS column
--
-- Stores the most-recent reminder key sent, e.g. "trial_reminder_3",
-- "trial_reminder_1", "trial_reminder_0". The cron skips a reminder if
-- trial_reminder_key already equals the key for that day, preventing
-- duplicate emails on cron redelivery or double-run.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_reminder_key text;

COMMENT ON COLUMN public.organizations.trial_reminder_key IS
  'Dedup key for the trial-expiring cron (self-managed trial path).
   Stores the last reminder sent, e.g. "trial_reminder_3". The cron
   skips a reminder when this matches the current-day key, then stamps
   it after a successful send. NULL = no reminder sent yet.';
