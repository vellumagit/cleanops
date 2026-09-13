-- ============================================================
-- Outbound email cap per org per day
-- ============================================================
--
-- 2026-09-11: a self-serve signup ("daoSHOP") created 35,423 clients and
-- used the Email client button to send 32,255 fake order confirmations on
-- Sollos letterhead in seven hours. Nothing counted, nothing refused.
--
-- Every org-branded send now bumps a per-day counter and is refused past
-- a cap: 50/day for an org under a week old, 500/day after, or the
-- override on the org. The counter is bumped by a definer function so
-- the increment is atomic and the table needs no policies at all.

create table if not exists public.org_email_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day             date not null,
  sent            integer not null default 0,
  primary key (organization_id, day)
);

alter table public.org_email_counters enable row level security;
-- No policies: service role only.

create or replace function public.bump_org_email_counter(p_org uuid, p_day date)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.org_email_counters (organization_id, day, sent)
  values (p_org, p_day, 1)
  on conflict (organization_id, day)
  do update set sent = public.org_email_counters.sent + 1
  returning sent;
$$;

revoke all on function public.bump_org_email_counter(uuid, date) from public;
grant execute on function public.bump_org_email_counter(uuid, date) to service_role;

alter table public.organizations
  add column if not exists email_daily_cap integer
    check (email_daily_cap is null or email_daily_cap >= 0);

comment on column public.organizations.email_daily_cap is
  'Override for the outbound email cap per day. NULL = default (50/day under a week old, 500/day after). 0 = sending off.';

notify pgrst, 'reload schema';
