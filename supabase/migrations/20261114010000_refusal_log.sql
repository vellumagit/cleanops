-- What the app told someone when it said no (2026-11-14).
--
-- On 2026-11-14 the owner of a company spent an afternoon being refused by
-- two rules and called, angry, to say nothing worked. Nothing had recorded
-- what she had been shown: her failed saves were rebuilt from request times
-- in a 50-line log window and the messages guessed. A refusal is returned
-- to the screen and, until now, kept nowhere.
--
-- One row per error message shown to a signed-in person (a red toast or an
-- error box), written by the app through /api/refusals. Read by the 8 AM
-- check, which counts yesterday's by message, and by whoever needs to know
-- what someone just hit. Kept 30 days.
--
-- Service role only, like cron_runs: no policies, so no signed-in user and
-- no anonymous key can read another person's errors, or their own.
--
-- RUN THIS BEFORE THE PUSH: the app starts writing to it on deploy. (If it
-- is missing the write fails quietly and nothing else is affected.)

create table if not exists public.refusal_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Who was shown it. Kept if the member is later deleted.
  membership_id   uuid references public.memberships(id) on delete set null,
  -- The page they were on: path only, no query string.
  path            text not null check (length(path) <= 300),
  -- How it was shown: a toast, or an error box on the page.
  kind            text not null check (kind in ('toast', 'alert')),
  -- The words on screen, cut to 600 characters.
  message         text not null check (length(message) between 1 and 600),
  created_at      timestamptz not null default now()
);

comment on table public.refusal_log is
  'Error messages shown to signed-in people. Written via /api/refusals, read by the morning check. Service role only.';

create index if not exists refusal_log_org_created_idx
  on public.refusal_log (organization_id, created_at desc);

alter table public.refusal_log enable row level security;
alter table public.refusal_log force row level security;
