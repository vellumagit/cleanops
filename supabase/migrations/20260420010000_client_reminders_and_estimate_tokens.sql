-- Infrastructure for two new client-facing email features, both of which
-- ship BEHIND the platform kill switch (CLIENT_EMAILS_PAUSED) and the
-- per-org automation toggles. The columns and indexes are needed regardless
-- so the runtime code doesn't crash when it runs.
--
-- 1. 24-hour booking reminder email to the client
--    - bookings.client_reminder_sent_at tracks "we already reminded this
--      client about this specific booking" so the daily cron never
--      double-sends.
--
-- 2. Send-estimate-to-client flow
--    - estimates.public_token is a 16-char URL-safe capability token
--      mirroring the pattern already in use on invoices. Clients view
--      the estimate at /e/<token> with no login.
--    - estimates.expires_at gives the owner the option to time-bound an
--      estimate (populated at send time: now + 30 days by default).
--    - estimates.client_email_sent_at stamps when the estimate was last
--      emailed so the admin UI can show "Sent on {date}".
--
-- Idempotent — safe to re-run.

-- ── 1. Bookings: client reminder tracking ─────────────────────────────
alter table public.bookings
  add column if not exists client_reminder_sent_at timestamptz;

comment on column public.bookings.client_reminder_sent_at is
  'Timestamp the client reminder email was sent for this booking. Prevents duplicate reminders if the daily cron catches the same booking across windows.';

-- Partial index for the cron lookup: only un-reminded future bookings.
create index if not exists bookings_client_reminder_pending_idx
  on public.bookings (scheduled_at)
  where client_reminder_sent_at is null;

-- ── 2. Estimates: public_token + send tracking ────────────────────────
alter table public.estimates
  add column if not exists public_token          text,
  add column if not exists expires_at            timestamptz,
  add column if not exists client_email_sent_at  timestamptz;

comment on column public.estimates.public_token is
  '16-char URL-safe capability token. Clients view the estimate at /e/<token> with no login.';
comment on column public.estimates.expires_at is
  'Optional expiration for the estimate. Generated as send_time + 30d by default.';
comment on column public.estimates.client_email_sent_at is
  'Timestamp the estimate was most recently emailed to the client. Surfaced in the admin UI.';

create unique index if not exists estimates_public_token_uidx
  on public.estimates (public_token)
  where public_token is not null;
