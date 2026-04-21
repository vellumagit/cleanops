-- Dedup columns for three new client-facing automations:
--
--   clients.last_rebook_prompt_at — the daily rebook cron won't re-prompt
--     the same client more than once per 30 days, even if they keep
--     dodging it. Tracked on the client row because the trigger is
--     "client has no future booking," not a specific booking.
--
--   estimates.client_followup_7d_sent_at — stamps when the "still
--     interested?" follow-up went out at 7 days past sent.
--
--   estimates.client_followup_14d_sent_at — same for the 14-day
--     "last chance" follow-up before the estimate auto-expires at day 30.
--
-- Idempotent — safe to re-run.

alter table public.clients
  add column if not exists last_rebook_prompt_at timestamptz;

comment on column public.clients.last_rebook_prompt_at is
  'Timestamp of the last rebooking prompt email sent to this client. The daily cron only prompts clients whose last prompt is NULL or older than 30 days.';

create index if not exists clients_rebook_ready_idx
  on public.clients (organization_id, last_rebook_prompt_at nulls first)
  where email is not null;

alter table public.estimates
  add column if not exists client_followup_7d_sent_at  timestamptz,
  add column if not exists client_followup_14d_sent_at timestamptz;

comment on column public.estimates.client_followup_7d_sent_at is
  'Set by the stale-estimate cron when the 7-day "still interested?" follow-up email is sent to the client. Dedup so the same estimate isn''t nagged repeatedly.';
comment on column public.estimates.client_followup_14d_sent_at is
  'Set by the stale-estimate cron when the 14-day "last chance" follow-up email is sent. The estimate auto-expires at day 30 via auto_expire_stale_estimates.';
