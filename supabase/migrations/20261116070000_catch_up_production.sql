-- Catch production up with the migrations, and close the member-wide edit rules.
--
-- WHY
-- A read-only comparison on 2026-11-16 (docs/production-drift-check.sql)
-- showed three migrations never ran on the live database:
--   * 20260913030000_insider_guards: none of its guard functions or triggers
--     exist. A cleaner is not limited to a job's status and notes; anyone may
--     make or change an owner; a cleaner may insert time entries for others;
--     a booking, invoice, estimate or contract may name another company's
--     client. Its removal of "employees can insert own pto requests" (which
--     lets a cleaner insert an approved request for any hours) didn't happen.
--   * 20260914010000_profitability_reports: the two report functions are
--     missing, so those reports can't load.
--   * 20261007020000_crew_update_bookings: the old "admins or assignee update
--     bookings" rule is still there.
-- And three hand-made rules, in no migration, let ANY active member of a
-- company update any booking, estimate or invoice in it (they check the
-- company, never the role): "Members can update their org bookings",
-- "...estimates", "...invoices" (docs/production-policy-check.sql).
-- Managers' booking edits and crew members' job updates in production go
-- through those rules today, so they are dropped here in the same
-- transaction that adds the correct ones.
--
-- WHAT THIS DOES, all or nothing:
--   1. Creates the functions exactly as the migrations leave them today,
--      with the same permissions. memberships_owner_guard is the Nov 11 body
--      (20261111020000), not the Sep 13 one, which compared the dropped
--      pay_type column. Replaying 20260913030000 as written would break every
--      admin editing their own membership.
--   2. Creates the eight guard triggers.
--   3. Adds the rules production lacks: "managers or crew update bookings"
--      and the owner/admin read rules on payroll runs and items and on
--      subcontractor bills and payouts.
--   4. Drops the three member-wide update rules, the old bookings rule and
--      the open time-off insert rule.
--
-- The body (functions, triggers, rules) was generated from the database the
-- migrations build, which is the one every test runs against, so production
-- ends up matching what was tested. On a database that already matches (any
-- test database), every statement is a no-op.
--
-- NOT HERE: 20260421020000_webhooks_unification (no company uses webhooks;
-- separate work), and the leftover membership_admin_notes table (2 rows of
-- employee notes; kept, not deleted).
--
-- Safe to run before or after the code push: the app is already tested
-- against these rules. Idempotent: safe to re-run.

begin;

-- The rule texts below name functions and types unqualified, as Postgres
-- prints them; make sure they resolve to public whatever the editor's path.
set local search_path = public, extensions;

-- ── Functions (as the migrations leave them today) ──
CREATE OR REPLACE FUNCTION public.is_service_role()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(current_setting('request.jwt.claims', true), '') = ''
      or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$function$;
revoke all on function public.is_service_role() from public, anon, authenticated, service_role;
grant execute on function public.is_service_role() to public;
grant execute on function public.is_service_role() to anon;
grant execute on function public.is_service_role() to authenticated;
grant execute on function public.is_service_role() to service_role;

CREATE OR REPLACE FUNCTION public.time_entries_employee_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record;
begin
  if public.is_service_role() then
    return new;
  end if;
  if public.current_user_has_role(new.organization_id, array['owner','admin','manager']::public.membership_role[]) then
    return new;
  end if;
  select pay_rate_cents, engagement into m
  from public.memberships
  where id = new.employee_id and organization_id = new.organization_id;
  if not found then
    raise exception 'time entry: employee % is not in organization %', new.employee_id, new.organization_id
      using errcode = '42501';
  end if;
  new.clock_in_at := now();
  new.clock_out_at := null;
  new.payroll_run_id := null;
  new.subcontractor_run_id := null;
  new.needs_review := coalesce(new.needs_review, false);
  new.pay_rate_cents_snapshot := m.pay_rate_cents;
  new.engagement_snapshot := coalesce(m.engagement, 'employee');
  return new;
end;
$function$;
revoke all on function public.time_entries_employee_insert_guard() from public, anon, authenticated, service_role;
grant execute on function public.time_entries_employee_insert_guard() to public;
grant execute on function public.time_entries_employee_insert_guard() to anon;
grant execute on function public.time_entries_employee_insert_guard() to authenticated;
grant execute on function public.time_entries_employee_insert_guard() to service_role;

CREATE OR REPLACE FUNCTION public.memberships_owner_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_is_owner boolean;
  is_self boolean;
begin
  if public.is_service_role() then
    return new;
  end if;
  caller_is_owner := public.current_user_has_role(new.organization_id, array['owner']::public.membership_role[]);
  if tg_op = 'INSERT' then
    if new.role = 'owner' and not caller_is_owner then
      raise exception 'only an owner can add an owner' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE
  if (old.role = 'owner' or new.role = 'owner') and not caller_is_owner then
    -- Touching an owner row at all (role, status, pay) or making someone an owner.
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.pay_rate_cents is distinct from old.pay_rate_cents then
      raise exception 'only an owner can change an owner''s role, status or pay' using errcode = '42501';
    end if;
  end if;
  is_self := exists (
    select 1 from public.memberships me
    where me.id = new.id and me.profile_id = auth.uid()
  );
  if is_self and not caller_is_owner then
    if new.role is distinct from old.role
       or new.pay_rate_cents is distinct from old.pay_rate_cents then
      raise exception 'you cannot change your own role or pay' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.memberships_owner_guard() from public, anon, authenticated, service_role;
grant execute on function public.memberships_owner_guard() to public;
grant execute on function public.memberships_owner_guard() to anon;
grant execute on function public.memberships_owner_guard() to authenticated;
grant execute on function public.memberships_owner_guard() to service_role;

CREATE OR REPLACE FUNCTION public.invitations_owner_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.is_service_role() then
    return new;
  end if;
  if new.role = 'owner'
     and not public.current_user_has_role(new.organization_id, array['owner']::public.membership_role[]) then
    raise exception 'only an owner can invite an owner' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.invitations_owner_guard() from public, anon, authenticated, service_role;
grant execute on function public.invitations_owner_guard() to public;
grant execute on function public.invitations_owner_guard() to anon;
grant execute on function public.invitations_owner_guard() to authenticated;
grant execute on function public.invitations_owner_guard() to service_role;

CREATE OR REPLACE FUNCTION public.bookings_assignee_column_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  before_j jsonb;
  after_j jsonb;
begin
  if public.is_service_role() then
    return new;
  end if;
  if public.current_user_has_role(new.organization_id, array['owner','admin','manager']::public.membership_role[]) then
    return new;
  end if;
  before_j := to_jsonb(old) - 'status' - 'notes' - 'updated_at';
  after_j  := to_jsonb(new) - 'status' - 'notes' - 'updated_at';
  if before_j is distinct from after_j then
    raise exception 'assignees may change a booking''s status and notes only' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.bookings_assignee_column_guard() from public, anon, authenticated, service_role;
grant execute on function public.bookings_assignee_column_guard() to public;
grant execute on function public.bookings_assignee_column_guard() to anon;
grant execute on function public.bookings_assignee_column_guard() to authenticated;
grant execute on function public.bookings_assignee_column_guard() to service_role;

CREATE OR REPLACE FUNCTION public.client_org_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  client_org uuid;
begin
  if new.client_id is null then
    return new;
  end if;
  select organization_id into client_org from public.clients where id = new.client_id;
  if client_org is null then
    raise exception 'client % does not exist', new.client_id using errcode = '23503';
  end if;
  if client_org <> new.organization_id then
    raise exception 'client % belongs to a different organization', new.client_id using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.client_org_guard() from public, anon, authenticated, service_role;
grant execute on function public.client_org_guard() to public;
grant execute on function public.client_org_guard() to anon;
grant execute on function public.client_org_guard() to authenticated;
grant execute on function public.client_org_guard() to service_role;

CREATE OR REPLACE FUNCTION public.is_booking_crew(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
           select 1
           from public.booking_assignees ba
           join public.memberships m on m.id = ba.membership_id
           where ba.booking_id = p_booking_id
             and m.profile_id = auth.uid()
             and m.status = 'active'
         )
      or exists (
           select 1
           from public.bookings b
           join public.memberships m on m.id = b.assigned_to
           where b.id = p_booking_id
             and m.profile_id = auth.uid()
             and m.status = 'active'
         );
$function$;
revoke all on function public.is_booking_crew(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_booking_crew(uuid) to anon;
grant execute on function public.is_booking_crew(uuid) to authenticated;
grant execute on function public.is_booking_crew(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.report_job_profitability(p_org uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with jobs as (
    select
      b.id,
      b.client_id,
      c.name as client_name,
      b.scheduled_at,
      coalesce(b.service_type_label, replace(b.service_type::text, '_', ' ')) as service,
      b.duration_minutes as quoted_minutes,
      b.total_cents as revenue_cents
    from public.bookings b
    join public.clients c on c.id = b.client_id
    where b.organization_id = p_org
      and b.status = 'completed'
      and b.archived_at is null
      and b.scheduled_at >= p_from
      and b.scheduled_at <= p_to
  ),
  entries as (
    select
      te.booking_id,
      te.employee_id,
      greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60))::int as minutes,
      coalesce(te.pay_rate_cents_snapshot, m.pay_rate_cents, 0) as rate_cents
    from public.time_entries te
    join public.memberships m on m.id = te.employee_id
    where te.organization_id = p_org
      and te.clock_out_at is not null
      and (
        te.booking_id in (select id from jobs)
        or (te.booking_id is null and te.clock_in_at >= p_from and te.clock_in_at <= p_to)
      )
  ),
  entry_cost as (
    select
      booking_id,
      employee_id,
      minutes,
      round(minutes * rate_cents / 60.0)::int as labor_cents
    from entries
  ),
  job_labor as (
    select
      booking_id,
      sum(minutes)::int as worked_minutes,
      sum(labor_cents)::int as labor_cents,
      count(distinct employee_id)::int as crew
    from entry_cost
    where booking_id is not null
    group by booking_id
  ),
  job_rows as (
    select
      j.*,
      coalesce(l.worked_minutes, 0) as worked_minutes,
      coalesce(l.labor_cents, 0) as labor_cents,
      coalesce(l.crew, 0) as crew,
      j.revenue_cents - coalesce(l.labor_cents, 0) as margin_cents
    from jobs j
    left join job_labor l on l.booking_id = j.id
  ),
  unassigned as (
    select
      coalesce(sum(minutes), 0)::int as minutes,
      coalesce(sum(labor_cents), 0)::int as labor_cents
    from entry_cost
    where booking_id is null
  ),
  bills as (
    select coalesce(sum(sb.amount_cents), 0)::int as cents
    from public.subcontractor_bills sb
    where sb.organization_id = p_org
      and sb.bill_date >= p_from::date
      and sb.bill_date <= p_to::date
  )
  select json_build_object(
    'totals', (
      select json_build_object(
        'jobs', count(*),
        'jobs_with_time', count(*) filter (where worked_minutes > 0),
        'revenue_cents', coalesce(sum(revenue_cents), 0),
        'labor_cents', coalesce(sum(labor_cents), 0),
        'margin_cents', coalesce(sum(margin_cents), 0),
        'quoted_minutes', coalesce(sum(quoted_minutes), 0),
        'worked_minutes', coalesce(sum(worked_minutes), 0),
        'unassigned_minutes', (select minutes from unassigned),
        'unassigned_labor_cents', (select labor_cents from unassigned),
        'contractor_bills_cents', (select cents from bills)
      )
      from job_rows
    ),
    'by_client', (
      select coalesce(json_agg(row_to_json(t) order by t.margin_cents desc), '[]'::json)
      from (
        select
          client_id,
          client_name,
          count(*)::int as jobs,
          sum(revenue_cents)::int as revenue_cents,
          sum(labor_cents)::int as labor_cents,
          sum(margin_cents)::int as margin_cents,
          sum(quoted_minutes)::int as quoted_minutes,
          sum(worked_minutes)::int as worked_minutes
        from job_rows
        group by client_id, client_name
      ) t
    ),
    'by_service', (
      select coalesce(json_agg(row_to_json(t) order by t.revenue_cents desc), '[]'::json)
      from (
        select
          service,
          count(*)::int as jobs,
          sum(revenue_cents)::int as revenue_cents,
          sum(labor_cents)::int as labor_cents,
          sum(margin_cents)::int as margin_cents,
          sum(quoted_minutes)::int as quoted_minutes,
          sum(worked_minutes)::int as worked_minutes
        from job_rows
        group by service
      ) t
    ),
    -- The jobs that lost money or ran long, worst first. Capped: the page
    -- shows a short list, and the aggregates above already cover every job.
    'worst_jobs', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select id, client_name, scheduled_at, service, quoted_minutes,
               worked_minutes, revenue_cents, labor_cents, margin_cents, crew
        from job_rows
        where worked_minutes > 0
        order by margin_cents asc, worked_minutes - quoted_minutes desc
        limit 8
      ) t
    )
  );
$function$;
revoke all on function public.report_job_profitability(uuid,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.report_job_profitability(uuid,timestamp with time zone,timestamp with time zone) to anon;
grant execute on function public.report_job_profitability(uuid,timestamp with time zone,timestamp with time zone) to authenticated;
grant execute on function public.report_job_profitability(uuid,timestamp with time zone,timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.report_cleaner_scorecard(p_org uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with entries as (
    select
      te.employee_id,
      te.booking_id,
      greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60))::int as minutes,
      round(
        greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60))
        * coalesce(te.pay_rate_cents_snapshot, m.pay_rate_cents, 0) / 60.0
      )::int as labor_cents,
      te.needs_review
    from public.time_entries te
    join public.memberships m on m.id = te.employee_id
    where te.organization_id = p_org
      and te.clock_out_at is not null
      and te.clock_in_at >= p_from
      and te.clock_in_at <= p_to
  ),
  booking_minutes as (
    select booking_id, sum(minutes) as total_minutes
    from entries
    where booking_id is not null
    group by booking_id
  ),
  attributed as (
    select
      e.employee_id,
      e.booking_id,
      e.minutes,
      e.labor_cents,
      e.needs_review,
      case
        when e.booking_id is null or bm.total_minutes = 0 then 0
        else b.total_cents::numeric * e.minutes / bm.total_minutes
      end as revenue_share,
      case
        when e.booking_id is null or bm.total_minutes = 0 then 0
        else b.duration_minutes::numeric * e.minutes / bm.total_minutes
      end as quoted_share
    from entries e
    left join booking_minutes bm on bm.booking_id = e.booking_id
    left join public.bookings b on b.id = e.booking_id
  ),
  per_person as (
    select
      employee_id,
      sum(minutes)::int as minutes,
      sum(labor_cents)::int as labor_cents,
      count(distinct booking_id)::int as jobs,
      round(sum(revenue_share))::int as revenue_cents,
      round(sum(quoted_share))::int as quoted_minutes,
      count(*) filter (where needs_review)::int as needs_review
    from attributed
    group by employee_id
  )
  select coalesce(json_agg(row_to_json(t) order by t.minutes desc), '[]'::json)
  from (
    select
      p.employee_id,
      coalesce(m.display_name, pr.full_name, 'Team member') as name,
      m.engagement,
      m.status,
      p.minutes,
      p.jobs,
      p.labor_cents,
      p.revenue_cents,
      p.quoted_minutes,
      p.needs_review,
      (
        select round(avg(r.rating)::numeric, 2)
        from public.reviews r
        where r.organization_id = p_org
          and r.employee_id = p.employee_id
          and r.submitted_at >= p_from and r.submitted_at <= p_to
      ) as avg_rating,
      (
        select count(*)::int
        from public.reviews r
        where r.organization_id = p_org
          and r.employee_id = p.employee_id
          and r.submitted_at >= p_from and r.submitted_at <= p_to
      ) as reviews,
      (
        select coalesce(sum(bo.amount_cents), 0)::int
        from public.bonuses bo
        where bo.organization_id = p_org
          and bo.employee_id = p.employee_id
          and bo.period_end >= p_from::date and bo.period_end <= p_to::date
      ) as bonus_cents,
      (
        select count(*)::int
        from public.bookings bk
        where bk.organization_id = p_org
          and bk.assigned_to = p.employee_id
          and bk.no_clock_in_flagged_at is not null
          and bk.scheduled_at >= p_from and bk.scheduled_at <= p_to
      ) as no_clock_in_flags
    from per_person p
    join public.memberships m on m.id = p.employee_id
    left join public.profiles pr on pr.id = m.profile_id
  ) t;
$function$;
revoke all on function public.report_cleaner_scorecard(uuid,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.report_cleaner_scorecard(uuid,timestamp with time zone,timestamp with time zone) to anon;
grant execute on function public.report_cleaner_scorecard(uuid,timestamp with time zone,timestamp with time zone) to authenticated;
grant execute on function public.report_cleaner_scorecard(uuid,timestamp with time zone,timestamp with time zone) to service_role;

-- ── Triggers ──
drop trigger if exists time_entries_employee_insert_guard on public.time_entries;
CREATE TRIGGER time_entries_employee_insert_guard BEFORE INSERT ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.time_entries_employee_insert_guard();
drop trigger if exists memberships_owner_guard on public.memberships;
CREATE TRIGGER memberships_owner_guard BEFORE INSERT OR UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.memberships_owner_guard();
drop trigger if exists invitations_owner_guard on public.invitations;
CREATE TRIGGER invitations_owner_guard BEFORE INSERT OR UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.invitations_owner_guard();
drop trigger if exists bookings_assignee_column_guard on public.bookings;
CREATE TRIGGER bookings_assignee_column_guard BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_assignee_column_guard();
drop trigger if exists bookings_client_org_guard on public.bookings;
CREATE TRIGGER bookings_client_org_guard BEFORE INSERT OR UPDATE OF client_id, organization_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.client_org_guard();
drop trigger if exists invoices_client_org_guard on public.invoices;
CREATE TRIGGER invoices_client_org_guard BEFORE INSERT OR UPDATE OF client_id, organization_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.client_org_guard();
drop trigger if exists estimates_client_org_guard on public.estimates;
CREATE TRIGGER estimates_client_org_guard BEFORE INSERT OR UPDATE OF client_id, organization_id ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.client_org_guard();
drop trigger if exists contracts_client_org_guard on public.contracts;
CREATE TRIGGER contracts_client_org_guard BEFORE INSERT OR UPDATE OF client_id, organization_id ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.client_org_guard();

-- ── Access rules the migrations have and production lacks ──
drop policy if exists "managers or crew update bookings" on public.bookings;
create policy "managers or crew update bookings" on public.bookings as permissive for update to authenticated
  using ((current_user_has_role(organization_id, ARRAY['owner'::membership_role, 'admin'::membership_role, 'manager'::membership_role]) OR is_booking_crew(id)))
  with check (((archived_at IS NULL) AND (current_user_has_role(organization_id, ARRAY['owner'::membership_role, 'admin'::membership_role, 'manager'::membership_role]) OR is_booking_crew(id))));
drop policy if exists "members read own org payroll_runs" on public.payroll_runs;
create policy "members read own org payroll_runs" on public.payroll_runs as permissive for select to public
  using ((organization_id IN ( SELECT memberships.organization_id
   FROM memberships
  WHERE ((memberships.profile_id = auth.uid()) AND (memberships.status = 'active'::membership_status) AND (memberships.role = ANY (ARRAY['owner'::membership_role, 'admin'::membership_role]))))));
drop policy if exists "members read own org payroll_items" on public.payroll_items;
create policy "members read own org payroll_items" on public.payroll_items as permissive for select to public
  using ((organization_id IN ( SELECT memberships.organization_id
   FROM memberships
  WHERE ((memberships.profile_id = auth.uid()) AND (memberships.status = 'active'::membership_status) AND (memberships.role = ANY (ARRAY['owner'::membership_role, 'admin'::membership_role]))))));
drop policy if exists "subcontractor_bills_select" on public.subcontractor_bills;
create policy "subcontractor_bills_select" on public.subcontractor_bills as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.organization_id = subcontractor_bills.organization_id) AND (m.profile_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::membership_role, 'admin'::membership_role, 'manager'::membership_role])) AND (m.status = 'active'::membership_status)))));
drop policy if exists "subcontractor_payouts_select" on public.subcontractor_payouts;
create policy "subcontractor_payouts_select" on public.subcontractor_payouts as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.organization_id = subcontractor_payouts.organization_id) AND (m.profile_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::membership_role, 'admin'::membership_role, 'manager'::membership_role])) AND (m.status = 'active'::membership_status)))));

-- ── Rules that exist only in production ──
drop policy if exists "Members can update their org bookings" on public.bookings;
drop policy if exists "Members can update their org estimates" on public.estimates;
drop policy if exists "Members can update their org invoices" on public.invoices;
drop policy if exists "admins or assignee update bookings" on public.bookings;
drop policy if exists "employees can insert own pto requests" on public.pto_requests;

commit;
