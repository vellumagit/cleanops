-- Online bookings are saved one at a time per company, with room checked
-- inside the same lock (src/lib/online-booking.ts).
--
-- 2026-11-25: an online booking is left for the office to staff, so the
-- double-booking guard (which works per cleaner) no longer decides who gets
-- the last free time. Each unstaffed online visit holds the people its
-- service needs instead. Checked after the insert, from the app, that was
-- not airtight: two visitors saving at the same instant each checked before
-- the other's save was visible, and both stayed. On a real server, twelve
-- visitors pressing for three free cleaners left four visits
-- (test/load/online-booking.load.test.ts).
--
-- Here the count and the insert happen under one lock per company, held
-- until commit, so the next save sees this one. The app works out how many
-- of the cleaners who take online bookings are free (p_free: their hours,
-- time off, jobs they are on); this counts what visits nobody is on yet
-- already need, at the busiest moment of the new visit (the same rule as
-- heldPeopleDuring in src/lib/open-times.ts), and inserts only if there is
-- room. Returns the new visit's id, or null when there isn't.

create or replace function public.insert_online_booking_if_room(
  p_row jsonb,
  p_end timestamptz,
  p_free integer,
  p_need integer,
  p_gap_minutes integer,
  p_shares boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := (p_row->>'organization_id')::uuid;
  v_start timestamptz := (p_row->>'scheduled_at')::timestamptz;
  v_gap interval := make_interval(mins => greatest(0, coalesce(p_gap_minutes, 0)));
  v_hi timestamptz;
  v_most integer;
  v_id uuid;
begin
  if v_org is null or v_start is null or p_end is null or p_end <= v_start then
    raise exception 'Invalid online booking' using errcode = '22023';
  end if;
  v_hi := p_end + v_gap;

  -- One online save at a time for this company.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 1618033988));

  with held as (
    -- Each unstaffed online visit, as [start, end + gap), needing its
    -- service's online crew size; a crew sharing the hours is each there
    -- for the length divided by the crew (onSiteMinutes).
    select
      b.scheduled_at as s,
      b.scheduled_at
        + make_interval(mins => case
            when (p_shares or b.divide_hours_evenly is true)
                 and greatest(1, coalesce(st.online_crew_size, 1)) >= 2
                 and coalesce(b.duration_minutes, 0) > 0
              then greatest(1, round(b.duration_minutes::numeric / greatest(1, coalesce(st.online_crew_size, 1)))::integer)
            else greatest(0, coalesce(b.duration_minutes, 0))
          end)
        + v_gap as e,
      greatest(1, coalesce(st.online_crew_size, 1)) as need
    from public.bookings b
    left join public.service_types st on st.id = b.service_type_id
    where b.organization_id = v_org
      and b.booked_online_at is not null
      and b.assigned_to is null
      and b.status <> 'cancelled'
      and b.scheduled_at > v_start - interval '1 day'
      and b.scheduled_at < v_hi
      and not exists (select 1 from public.booking_assignees a where a.booking_id = b.id)
  ),
  near as (
    select * from held where s < v_hi and e > v_start
  ),
  points as (
    select v_start as t
    union
    select s from near where s > v_start and s < v_hi
  )
  select coalesce(max((select coalesce(sum(n.need), 0) from near n where n.s <= p.t and p.t < n.e)), 0)
    into v_most
    from points p;

  if coalesce(p_free, 0) - v_most < greatest(1, coalesce(p_need, 1)) then
    return null;
  end if;

  insert into public.bookings (
    organization_id, client_id, assigned_to, scheduled_at, scheduled_local, scheduled_tz,
    duration_minutes, service_type, service_type_id, service_type_label, status,
    total_cents, address, booked_online_at
  ) values (
    v_org,
    (p_row->>'client_id')::uuid,
    null,
    v_start,
    nullif(p_row->>'scheduled_local', ''),
    nullif(p_row->>'scheduled_tz', ''),
    (p_row->>'duration_minutes')::integer,
    (p_row->>'service_type')::public.service_type,
    nullif(p_row->>'service_type_id', '')::uuid,
    p_row->>'service_type_label',
    (p_row->>'status')::public.booking_status,
    coalesce((p_row->>'total_cents')::integer, 0),
    nullif(p_row->>'address', ''),
    coalesce((p_row->>'booked_online_at')::timestamptz, now())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.insert_online_booking_if_room(jsonb, timestamptz, integer, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.insert_online_booking_if_room(jsonb, timestamptz, integer, integer, integer, boolean)
  to service_role;
