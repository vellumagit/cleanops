-- =============================================================================
-- One round trip for the app shell, instead of thirteen
-- supabase/migrations/20260903020000_app_shell_counts.sql
-- =============================================================================
-- /app's layout is the front door of every page in the office app, and it was
-- awaiting THIRTEEN separate PostgREST calls before any page content could
-- render: the profile row, the org row, and eleven nav-badge counts. They ran
-- in parallel, so the cost was the slowest of them — measured at ~840ms from
-- a developer machine, paid again on every single navigation, before the page
-- being opened had fetched anything of its own.
--
-- The data is tiny (hundreds of rows per table); the cost was never the query,
-- it was the round trip. So: one function, one trip, counts computed next to
-- the data where they take microseconds.
--
-- SECURITY INVOKER, deliberately: every count below is subject to the caller's
-- own RLS policies exactly as the thirteen separate reads were. This function
-- widens nothing. chat_unread_total() stays SECURITY DEFINER on its own terms
-- and is simply called through.
--
-- It also FIXES a quiet bug. Five of those counts — today's bookings, overdue
-- invoices, sent estimates, new reviews, overdue tasks — carried no
-- organization_id filter and leaned on RLS alone. RLS scopes to every org the
-- caller belongs to, so an owner of two organizations saw both orgs' numbers
-- added together in one badge. Every count here is explicitly org-scoped.

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

notify pgrst, 'reload schema';
