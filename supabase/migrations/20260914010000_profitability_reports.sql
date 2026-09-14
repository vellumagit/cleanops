-- =============================================================================
-- Reports that answer "did we make money on it" and "how is each cleaner doing"
-- supabase/migrations/20260914010000_profitability_reports.sql
-- =============================================================================
-- Until now Reports could say how much came in. It could not say what a job
-- COST, even though every closed time entry carries the wage it was worked at
-- (pay_rate_cents_snapshot, 20260601030000) and the booking it was worked on.
-- Revenue minus that wage, per job, per client, per service, is the number a
-- cleaning company lives or dies by, and it sat in the database unread.
--
-- Two functions, one round trip each, aggregated next to the data. Both are
-- SECURITY INVOKER: they read time_entries, bookings, memberships and reviews
-- under the caller's own RLS, and the reports page only lets owners and
-- admins call them. Nothing is widened.
--
-- Labor is computed EXACTLY the way payroll computes it (payroll-run-create.ts,
-- subcontractor-payables.ts): whole minutes between clock-in and clock-out,
-- rounded; rate = the entry's snapshot, else the worker's current wage; pay =
-- round(minutes * rate / 60). A profitability report that disagreed with the
-- pay run by a rounding cent would not be trusted, so it doesn't.
--
-- Revenue per job is the booking's own total_cents — what the visit was
-- priced at. Invoices can bundle many visits (period billing), so the invoice
-- is the wrong grain for "this job"; the booking is the only per-visit price.
-- Tips are excluded on both sides (pass-through money, never revenue).
--
-- Open entries (no clock-out) are not counted anywhere: they have no cost yet.

create or replace function public.report_job_profitability(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.report_job_profitability(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_job_profitability(uuid, timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Cleaner scorecard: one row per person who worked in the window.
-- -----------------------------------------------------------------------------
-- Hours and labor are the person's own closed entries clocked in the window.
-- Revenue is attributed by share of minutes: a two-person job split 60/40 by
-- clocked time credits 60% of the booking's price to one and 40% to the
-- other, so the column sums to the jobs' revenue instead of double-counting.
-- Quoted minutes use the same share of the booking's duration, so "worked vs
-- quoted" is fair to someone who only did half the job.
--
-- Ratings are reviews whose employee_id names the person, submitted in the
-- window. Bonuses are those whose period ends in the window. Flags are
-- bookings assigned to the person that were flagged for no clock-in.

create or replace function public.report_cleaner_scorecard(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.report_cleaner_scorecard(uuid, timestamptz, timestamptz) from public;
grant execute on function public.report_cleaner_scorecard(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
