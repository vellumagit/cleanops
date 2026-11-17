-- =============================================================================
-- Per-person read state for team announcements, and an anchor day for
-- recurring invoices
-- supabase/migrations/20261117020000_notification_reads_and_anchor_day.sql
-- =============================================================================
-- Safe to run more than once. Safe to run before or after the code that uses
-- it is deployed, but run it BEFORE: the new code reads notification_reads.
--
-- 1. A team announcement (a notification with no recipient) is ONE row with
--    one read_at. Whoever read it first, or pressed "mark all read", cleared
--    it for the whole company. Each person's read now lives in
--    notification_reads; the announcement's own read_at is no longer written.
--    Announcements already marked read stay read for everyone (their read_at
--    is kept and still honoured), so nothing old comes back as unread.
--
-- 2. A recurring invoice on the 31st was moved to the 28th by February and
--    stayed on the 28th forever, because the next date was worked out from
--    the last date. anchor_day remembers the day of the month the series is
--    meant to bill on. Existing series take the day they bill on today; one
--    that has already drifted has to be re-dated by hand once.

-- ── 1. notification_reads ───────────────────────────────────────────────────
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, membership_id)
);

create index if not exists notification_reads_membership_idx
  on public.notification_reads (membership_id);
create index if not exists notification_reads_organization_idx
  on public.notification_reads (organization_id);

alter table public.notification_reads enable row level security;

drop policy if exists "members read own notification reads" on public.notification_reads;
create policy "members read own notification reads"
on public.notification_reads for select
using (
  membership_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- A person records a read only as themselves, in their own company, and only
-- for a notification they can see (the inner read of notifications runs under
-- that table's own rule, min_role included).
drop policy if exists "members insert own notification reads" on public.notification_reads;
create policy "members insert own notification reads"
on public.notification_reads for insert
with check (
  membership_id in (
    select m.id from public.memberships m
    where m.profile_id = auth.uid()
      and m.status = 'active'
      and m.organization_id = notification_reads.organization_id
  )
  and exists (
    select 1 from public.notifications n
    where n.id = notification_reads.notification_id
      and n.organization_id = notification_reads.organization_id
  )
);

revoke all on public.notification_reads from anon;
grant select, insert on public.notification_reads to authenticated;
grant all on public.notification_reads to service_role;

-- ── 2. The bell's count: unread for THIS person ─────────────────────────────
create or replace function public.app_shell_counts(
  p_org uuid,
  p_membership uuid,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_reviews_since timestamptz
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'profile_full_name', (
      select p.full_name from public.profiles p
      where p.id = (select m.profile_id from public.memberships m where m.id = p_membership)
    ),
    'org_onboarding_completed_at', (
      select o.onboarding_completed_at from public.organizations o where o.id = p_org
    ),
    'org_logo_url', (
      select o.logo_url from public.organizations o where o.id = p_org
    ),
    'org_brand_color', (
      select o.brand_color from public.organizations o where o.id = p_org
    ),
    'org_name', (
      select o.name from public.organizations o where o.id = p_org
    ),
    'unread_notifications', (
      select count(*) from public.notifications n
      where n.organization_id = p_org
        and (n.recipient_membership_id is null or n.recipient_membership_id = p_membership)
        and n.read_at is null
        and not exists (
          select 1 from public.notification_reads r
          where r.notification_id = n.id and r.membership_id = p_membership
        )
    ),
    'today_bookings', (
      select count(*) from public.bookings b
      where b.organization_id = p_org
        and b.scheduled_at >= p_today_start
        and b.scheduled_at <= p_today_end
    ),
    'overdue_invoices', (
      select count(*) from public.invoices i
      where i.organization_id = p_org and i.status = 'overdue'
    ),
    'pending_estimates', (
      select count(*) from public.estimates e
      where e.organization_id = p_org and e.status = 'sent'
    ),
    'unread_chat', coalesce(public.chat_unread_total(), 0),
    'new_reviews', (
      select count(*) from public.reviews r
      where r.organization_id = p_org and r.submitted_at >= p_reviews_since
    ),
    'pending_requests', (
      select count(*) from public.booking_requests br
      where br.organization_id = p_org and br.status = 'pending'
    ),
    'open_job_requests', (
      select count(*) from public.client_job_requests jr
      where jr.organization_id = p_org and jr.status = 'open'
    ),
    'overdue_tasks', (
      select count(*) from public.tasks t
      where t.organization_id = p_org
        and t.due_at <= p_today_end
        and t.completed_at is null
    ),
    'new_applicants', (
      select count(*) from public.job_applicants a
      where a.organization_id = p_org and a.status = 'new'
    ),
    'new_leads', (
      select count(*) from public.clients c
      where c.organization_id = p_org
        and c.lifecycle = 'lead'
        and c.lead_stage = 'new'
        and c.archived_at is null
    )
  );
$$;

revoke all on function public.app_shell_counts(uuid, uuid, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.app_shell_counts(uuid, uuid, timestamptz, timestamptz, timestamptz) to authenticated;

-- ── 3. invoice_series.anchor_day ────────────────────────────────────────────
alter table public.invoice_series
  add column if not exists anchor_day smallint
  check (anchor_day between 1 and 31);

update public.invoice_series
   set anchor_day = extract(day from next_run_at at time zone 'UTC')::smallint
 where anchor_day is null;

comment on column public.invoice_series.anchor_day is
  'Day of the month this series is meant to bill on. Monthly and quarterly runs aim for this day, clamped to the month''s last day, so the 31st does not become the 28th for good after February.';

notify pgrst, 'reload schema';
