-- A cleaner's last working day: nobody can put her on a visit after it.
--
-- WHY
-- Svitlana, 2026-11-23: "my cleaner is working till December 18th, and then
-- that's her last day ... I would like not to be able to add anything to her
-- schedule if she's done." Deactivating someone is the only way to stop her
-- being booked, and that is for the day she leaves, not three weeks before.
-- Until then the office has to remember, and a series saved with her on it
-- keeps putting her on visits in January.
--
-- NOW
-- memberships.last_working_day. A visit on a later date (the company's own
-- calendar) cannot have her on it. The rule lives in the overlap guard, so
-- every way a crew is written obeys it the way it obeys "already booked
-- then":
--   - a one-off save, a drag on the schedule, a client moving their own
--     visit, an online booking: refused, with her name and the date
--     (23P01, the guard's own code, so every caller that already treats an
--     overlap as "not free" does the same here; hint 'last_working_day');
--   - a recurring series' crew save, and a series moved to a new day: she
--     goes on every visit up to her last day and comes off each one after
--     it, marked "Needs cover" (the skip-clashes path, 20261119040000);
--   - the nightly series extension leaves her off later visits (app code),
--     and falls back to the guard's refusal like any overlap.
-- What it does NOT touch: a visit she is already on stays editable. The
-- guard only refuses what a change adds, and setting the date takes her off
-- every later visit straight away (take_member_off_after_last_day below).
--
-- HOW
-- booking_schedule_conflicts names the other bookings a set of windows
-- overlaps. It now also names the booking ITSELF when someone in the
-- windows is past her last day on that date: "this person can't be here".
-- Everything built on it (booking_conflict_pairs, the "new, and hers to
-- answer for" test, drop_new_schedule_conflicts) then treats it as one more
-- clash, and the three places that raise say which kind it was.
--
-- Run BEFORE the code push: the app reads the new column and calls the new
-- function. Idempotent. Changes no existing rows.

begin;

alter table public.memberships add column if not exists last_working_day date;
comment on column public.memberships.last_working_day is
  'The last date (the company''s calendar) this person works. A visit on a later date cannot have them on its crew: the overlap guard refuses it (migration 20261124010000). Null when no end is set.';

-- Is this person finished by this moment? Judged on the company's own
-- calendar: a 7 PM visit on the 18th is still the 18th in Edmonton.
create or replace function public.member_past_last_day(
  p_organization_id uuid,
  p_membership_id uuid,
  p_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.id = p_membership_id
      and m.organization_id = p_organization_id
      and m.last_working_day is not null
      and p_at is not null
      and (p_at at time zone coalesce(nullif(o.timezone, ''), 'America/Toronto'))::date > m.last_working_day
  );
$$;
revoke all on function public.member_past_last_day(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.member_past_last_day(uuid, uuid, timestamptz) to service_role;

-- The refusal, in words: who, and her last day.
create or replace function public.raise_member_finished(
  p_organization_id uuid,
  p_membership_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  who text;
  last_day date;
begin
  select coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(pr.full_name), ''), 'This cleaner'),
         m.last_working_day
    into who, last_day
  from public.memberships m
  left join public.profiles pr on pr.id = m.profile_id
  where m.id = p_membership_id
    and m.organization_id = p_organization_id;
  if last_day is null then
    return;
  end if;
  raise exception '%''s last working day is %, so % can''t be on a visit after that.',
    who, to_char(last_day, 'FMDay, FMMonth FMDD, YYYY'), who
    using errcode = '23P01', hint = 'last_working_day';
end;
$$;
revoke all on function public.raise_member_finished(uuid, uuid) from public, anon, authenticated;
grant execute on function public.raise_member_finished(uuid, uuid) to service_role;

-- As in 20261108060000, plus the last branch: the booking itself, when
-- someone in the windows has finished by then. Only when a booking is named
-- (the guard always names one; the crew picker asks for a new visit with
-- none and reads last_working_day itself).
create or replace function public.booking_schedule_conflicts(
  p_organization_id uuid,
  p_booking_id uuid,
  p_proposed_windows jsonb
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  lo timestamptz;
  hi timestamptz;
  org_shares boolean;
begin
  if jsonb_typeof(p_proposed_windows) is distinct from 'array' then
    raise exception 'Invalid proposed schedule windows' using errcode = '22023';
  end if;
  select min(p.start_at), max(p.end_at) into lo, hi
  from jsonb_to_recordset(p_proposed_windows) as p(membership_id uuid, start_at timestamptz, end_at timestamptz)
  where p.membership_id is not null and p.start_at < p.end_at;
  if lo is null then
    return;
  end if;
  org_shares := public.booking_shares_hours(false, p_organization_id);

  return query
  with other as (
    select b.id, b.scheduled_at, b.duration_minutes, b.assigned_to,
           (coalesce(b.divide_hours_evenly, false) or org_shares) as shares,
           (
             select count(*) from (
               select ba.membership_id from public.booking_assignees ba where ba.booking_id = b.id
               union
               select b.assigned_to where b.assigned_to is not null
             ) c
           )::integer as crew
    from public.bookings b
    where b.organization_id = p_organization_id
      and b.id is distinct from p_booking_id
      and b.status <> 'cancelled'
      and b.scheduled_at < hi
      and b.scheduled_at > lo - interval '3 days'
  ),
  team as (
    select o.*,
           case when o.shares and o.crew >= 2
             then greatest(1, round(coalesce(o.duration_minutes, 0)::numeric / o.crew)::integer)
             else coalesce(o.duration_minutes, 0)
           end as team_minutes
    from other o
  ),
  member_windows as (
    select t.id as booking_id, ba.membership_id,
           t.scheduled_at + greatest(0, coalesce(ba.split_start_offset_minutes, 0)) * interval '1 minute' as s,
           t.scheduled_at + (
             greatest(0, coalesce(ba.split_start_offset_minutes, 0))
             + greatest(0, coalesce(ba.split_duration_minutes, t.team_minutes))
           ) * interval '1 minute' as e
    from team t
    join public.booking_assignees ba on ba.booking_id = t.id
    union all
    select t.id, t.assigned_to, t.scheduled_at, t.scheduled_at + t.team_minutes * interval '1 minute'
    from team t
    where t.assigned_to is not null
      and not exists (
        select 1 from public.booking_assignees ba
        where ba.booking_id = t.id and ba.membership_id = t.assigned_to
      )
  )
  select w.booking_id
  from member_windows w
  join jsonb_to_recordset(p_proposed_windows) as p(membership_id uuid, start_at timestamptz, end_at timestamptz)
    on p.membership_id = w.membership_id
   and w.s < w.e
   and w.s < p.end_at
   and w.e > p.start_at
  union
  select p_booking_id
  where p_booking_id is not null
    and exists (
      select 1
      from jsonb_to_recordset(p_proposed_windows) as p(membership_id uuid, start_at timestamptz, end_at timestamptz)
      where p.membership_id is not null
        and p.start_at < p.end_at
        and public.member_past_last_day(p_organization_id, p.membership_id, p.start_at)
    );
end;
$$;
revoke all on function public.booking_schedule_conflicts(uuid, uuid, jsonb) from public;

-- Who in these windows has finished by then, or null.
create or replace function public.finished_member_in(
  p_organization_id uuid,
  p_windows jsonb
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.membership_id
  from jsonb_to_recordset(case when jsonb_typeof(p_windows) = 'array' then p_windows else '[]'::jsonb end)
    as p(membership_id uuid, start_at timestamptz, end_at timestamptz)
  where p.membership_id is not null
    and p.start_at < p.end_at
    and public.member_past_last_day(p_organization_id, p.membership_id, p.start_at)
  limit 1;
$$;
revoke all on function public.finished_member_in(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finished_member_in(uuid, jsonb) to service_role;

-- bookings, per row: as in 20261108060000, saying which refusal it is.
create or replace function public.check_booking_schedule_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  skip_primary uuid;
  new_windows jsonb;
  old_windows jsonb;
  added uuid[];
begin
  if tg_op = 'UPDATE' then
    if new.scheduled_at is not distinct from old.scheduled_at
      and new.duration_minutes is not distinct from old.duration_minutes
      and new.assigned_to is not distinct from old.assigned_to
      and coalesce(new.splits, '[]'::jsonb) is not distinct from coalesce(old.splits, '[]'::jsonb)
      and new.organization_id is not distinct from old.organization_id
      and (new.status = 'cancelled' or old.status <> 'cancelled')
    then
      return new;
    end if;
  end if;
  if new.status = 'cancelled' then
    return new;
  end if;

  perform public.lock_booking_schedule_writes(new.organization_id);

  if tg_op = 'UPDATE' and old.assigned_to is distinct from new.assigned_to then
    skip_primary := old.assigned_to;
  end if;
  new_windows := public.booking_member_windows(
    new.id, new.organization_id, new.scheduled_at, new.duration_minutes,
    new.splits, new.assigned_to, new.divide_hours_evenly, skip_primary
  );
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    old_windows := public.booking_member_windows(
      old.id, old.organization_id, old.scheduled_at, old.duration_minutes,
      old.splits, old.assigned_to, old.divide_hours_evenly, null
    );
  else
    old_windows := '[]'::jsonb;
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into added
  from (
    select t.id from public.booking_schedule_conflicts(new.organization_id, new.id, new_windows) as t(id)
    except
    select t.id from public.booking_schedule_conflicts(new.organization_id, new.id, old_windows) as t(id)
  ) x;
  if cardinality(added) > 0 then
    if new.id = any(added) then
      perform public.raise_member_finished(new.organization_id, public.finished_member_in(new.organization_id, new_windows));
    end if;
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.check_booking_schedule_write() from public;

-- booking_assignees, per row: as in 20261108060000, saying which refusal.
create or replace function public.check_booking_assignee_schedule_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.bookings%rowtype;
  team_minutes integer;
  crew_count integer;
  new_window jsonb;
  old_window jsonb := '[]'::jsonb;
  new_off integer;
  new_dur integer;
  old_off integer;
  old_dur integer;
  added uuid[];
begin
  if tg_op = 'UPDATE' then
    if new.booking_id is not distinct from old.booking_id
      and new.membership_id is not distinct from old.membership_id
      and new.split_start_offset_minutes is not distinct from old.split_start_offset_minutes
      and new.split_duration_minutes is not distinct from old.split_duration_minutes
    then
      return new;
    end if;
  end if;

  select * into parent from public.bookings where id = new.booking_id;
  if not found then
    return new;
  end if;
  perform public.lock_booking_schedule_writes(parent.organization_id);
  if parent.status = 'cancelled' then
    return new;
  end if;

  select count(*) into crew_count from (
    select ba.membership_id from public.booking_assignees ba where ba.booking_id = parent.id
    union
    select parent.assigned_to where parent.assigned_to is not null
  ) c;
  team_minutes := case
    when public.booking_shares_hours(parent.divide_hours_evenly, parent.organization_id) and crew_count >= 2
      then greatest(1, round(coalesce(parent.duration_minutes, 0)::numeric / crew_count)::integer)
    else coalesce(parent.duration_minutes, 0)
  end;

  new_off := greatest(0, coalesce(new.split_start_offset_minutes, 0));
  new_dur := greatest(0, coalesce(new.split_duration_minutes, team_minutes));
  if new_dur = 0 then
    return new;
  end if;
  new_window := jsonb_build_array(jsonb_build_object(
    'membership_id', new.membership_id,
    'start_at', parent.scheduled_at + new_off * interval '1 minute',
    'end_at', parent.scheduled_at + (new_off + new_dur) * interval '1 minute'
  ));

  if tg_op = 'UPDATE' and new.membership_id = old.membership_id and new.booking_id = old.booking_id then
    old_off := greatest(0, coalesce(old.split_start_offset_minutes, 0));
    old_dur := greatest(0, coalesce(old.split_duration_minutes, team_minutes));
    if old_dur > 0 then
      old_window := jsonb_build_array(jsonb_build_object(
        'membership_id', old.membership_id,
        'start_at', parent.scheduled_at + old_off * interval '1 minute',
        'end_at', parent.scheduled_at + (old_off + old_dur) * interval '1 minute'
      ));
    end if;
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into added
  from (
    select t.id from public.booking_schedule_conflicts(parent.organization_id, parent.id, new_window) as t(id)
    except
    select t.id from public.booking_schedule_conflicts(parent.organization_id, parent.id, old_window) as t(id)
  ) x;
  if cardinality(added) > 0 then
    if parent.id = any(added) then
      perform public.raise_member_finished(parent.organization_id, new.membership_id);
    end if;
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.check_booking_assignee_schedule_write() from public;

-- The once-at-the-end question: as in 20261115010000, saying which refusal.
create or replace function public.assert_no_new_schedule_conflicts(
  p_organization_id uuid,
  p_booking_ids uuid[],
  p_before_state jsonb,
  p_before_pairs jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  after_state jsonb := public.booking_schedule_snapshot(p_organization_id, p_booking_ids);
  bad record;
begin
  select now_pair.pair_booking_id, now_pair.pair_membership_id, now_pair.pair_other_id
    into bad
  from public.booking_conflict_pairs(p_organization_id, p_booking_ids) now_pair
  where not exists (
    select 1
    from jsonb_to_recordset(p_before_pairs) as was(b uuid, m uuid, o uuid)
    where was.b = now_pair.pair_booking_id
      and was.m = now_pair.pair_membership_id
      and was.o = now_pair.pair_other_id
  )
  -- Not hers to answer for: the booking's time and sharing are as they
  -- were, and so is her own place on it. Her share grew only because
  -- someone else came off.
  and not (
    (p_before_state -> now_pair.pair_booking_id::text -> 'sched')
      is not distinct from (after_state -> now_pair.pair_booking_id::text -> 'sched')
    and (p_before_state -> now_pair.pair_booking_id::text -> 'crew') ? now_pair.pair_membership_id::text
    and (p_before_state -> now_pair.pair_booking_id::text -> 'crew' -> now_pair.pair_membership_id::text)
      is not distinct from (after_state -> now_pair.pair_booking_id::text -> 'crew' -> now_pair.pair_membership_id::text)
  )
  -- Say "she has finished" before "she is busy" when a save does both.
  order by (now_pair.pair_other_id = now_pair.pair_booking_id) desc
  limit 1;

  if found then
    if bad.pair_other_id = bad.pair_booking_id then
      perform public.raise_member_finished(p_organization_id, bad.pair_membership_id);
    end if;
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
end;
$$;
revoke all on function public.assert_no_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.assert_no_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb) to service_role;

-- Setting the date: take her off every open visit after it, at once, and
-- mark each "Needs cover" so the office sees what to re-staff. Taking
-- someone off is never refused (the guard has never checked removals: the
-- others' share growing is the morning check's to report), so the per-row
-- guard stands aside for the writes. Returns the visits she came off.
create or replace function public.take_member_off_after_last_day(
  p_organization_id uuid,
  p_membership_id uuid
)
returns table (booking_id uuid, scheduled_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  already_deferred boolean := public.booking_schedule_check_deferred();
  r record;
  new_lead uuid;
  keep jsonb;
  patch jsonb;
  member_text text := p_membership_id::text;
begin
  if p_organization_id is null or p_membership_id is null then
    raise exception 'Invalid input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id
      and m.organization_id = p_organization_id
      and m.last_working_day is not null
  ) then
    return;
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);
  perform set_config('sollos.schedule_check', 'batch', true);

  for r in
    select b.id, b.scheduled_at, b.splits
    from public.bookings b
    where b.organization_id = p_organization_id
      and b.status in ('pending', 'confirmed')
      and public.member_past_last_day(p_organization_id, p_membership_id, b.scheduled_at)
      and (
        b.assigned_to = p_membership_id
        or exists (
          select 1 from public.booking_assignees ba
          where ba.booking_id = b.id and ba.membership_id = p_membership_id
        )
        or (
          jsonb_typeof(b.splits) = 'array'
          and exists (
            select 1 from jsonb_array_elements(b.splits) s
            where s ->> 'assigned_to' = member_text
          )
        )
      )
    order by b.scheduled_at
  loop
    -- Who leads the visit once she is off: the lead if it wasn't her,
    -- otherwise the first person left (as drop_new_schedule_conflicts).
    select ba.membership_id into new_lead
    from public.booking_assignees ba
    where ba.booking_id = r.id
      and ba.membership_id <> p_membership_id
    order by ba.is_primary desc, ba.split_index nulls last, ba.membership_id
    limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
        'booking_id', ba.booking_id,
        'membership_id', ba.membership_id,
        'is_primary', ba.membership_id = new_lead,
        'split_index', ba.split_index,
        'split_start_offset_minutes', ba.split_start_offset_minutes,
        'split_duration_minutes', ba.split_duration_minutes,
        'acceptance_status', ba.acceptance_status,
        'responded_at', ba.responded_at,
        'completed_at', ba.completed_at
      )), '[]'::jsonb)
      into keep
    from public.booking_assignees ba
    where ba.booking_id = r.id
      and ba.membership_id <> p_membership_id;

    patch := jsonb_build_object('assigned_to', new_lead);
    -- Her segment on split times goes too, or the visit still holds her.
    if jsonb_typeof(r.splits) = 'array' and jsonb_array_length(r.splits) > 0 then
      patch := patch || jsonb_build_object('splits', (
        select coalesce(jsonb_agg(s.value order by s.ordinality), '[]'::jsonb)
        from jsonb_array_elements(r.splits) with ordinality as s(value, ordinality)
        where coalesce(s.value ->> 'assigned_to', '') <> member_text
      ));
    end if;

    perform public.update_booking_assignments_v2_apply(
      p_organization_id, array[r.id], patch, keep
    );

    update public.bookings b
    set cover_needed = coalesce(b.cover_needed, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('membership_id', p_membership_id, 'other_booking_id', b.id))
    where b.id = r.id
      and b.organization_id = p_organization_id
      and not coalesce(b.cover_needed, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('membership_id', p_membership_id));

    booking_id := r.id;
    scheduled_at := r.scheduled_at;
    return next;
  end loop;

  if not already_deferred then
    perform set_config('sollos.schedule_check', '', true);
  end if;
end;
$$;
revoke all on function public.take_member_off_after_last_day(uuid, uuid) from public, anon, authenticated;
grant execute on function public.take_member_off_after_last_day(uuid, uuid) to service_role;

commit;

-- PostgREST caches the schema; without this the new column and function
-- are invisible to the API until the cache happens to refresh.
notify pgrst, 'reload schema';
