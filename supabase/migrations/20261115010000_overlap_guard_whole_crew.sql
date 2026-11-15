-- =============================================================================
-- The overlap guard judges a crew once it is whole
-- =============================================================================
-- 2026-11-15, Svit. Stacie Moore, three hours at 9:00, to be given to Olha
-- and Vira, who are both on another job at 11:30. With hours shared across
-- the crew each of them is there 9:00 to 10:30, so nothing overlaps. Every
-- save was refused: "A cleaner already has an overlapping booking".
--
-- The guard ran per row. update_booking_assignments_v2 writes the booking
-- (with its new lead) and then the crew rows one at a time, and each write
-- was checked against the crew as it stood at that instant. The lead was
-- checked while she was the only person on the job: one person, three
-- hours, 9:00 to 12:00, into the 11:30 job. The second person's row would
-- have brought the share down to an hour and a half, but the save was
-- already refused. Any crew of two or more put on a job together could be
-- refused for a clash that the finished crew does not have.
--
-- Now, inside the two functions that save a crew, the per-row guard stands
-- aside and the same question is asked once at the end, about the finished
-- booking: which (person, other job) clashes exist now that did not exist
-- before this save? A clash is still refused only if the change adds it.
--
-- One thing deliberately kept as it was: taking someone OFF a shared job
-- makes the others' share longer, and that was never checked (the guard
-- only watched rows being added or changed). It still is not. Removing a
-- cleaner who called in sick must not be refused because the cleaner who
-- is left now runs long; the morning check lists that as a double-booking
-- instead (src/lib/mismatch-check.ts).
--
-- The per-row guard is unchanged for every other write (a new booking, the
-- nightly series extension, a direct crew row).
--
-- Run BEFORE the push is not required: the app calls the same two function
-- names with the same arguments. Safe to run more than once.
-- =============================================================================

-- All or nothing: the guard's triggers are replaced inside the same
-- transaction, so there is no moment with no guard, and a failure part-way
-- leaves everything as it was.
begin;

-- True while a crew-saving function is mid-write and will ask the question
-- itself at the end. Transaction-local, so it cannot outlive the save.
create or replace function public.booking_schedule_check_deferred()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('sollos.schedule_check', true), '') = 'batch';
$$;
revoke all on function public.booking_schedule_check_deferred() from public, anon, authenticated;
grant execute on function public.booking_schedule_check_deferred() to service_role;

-- The condition is written out in the trigger rather than calling the
-- function above: a trigger's WHEN runs as whoever made the write, and a
-- signed-in user has no grant on that function, so calling it refused
-- every ordinary booking save with "permission denied" (caught by
-- test/db/crew-clashes.api.test.ts before this ever ran anywhere).
drop trigger if exists booking_schedule_conflict_guard on public.bookings;
create trigger booking_schedule_conflict_guard
after insert or update of
  organization_id, scheduled_at, scheduled_local, scheduled_tz,
  duration_minutes, assigned_to, splits, status
on public.bookings
for each row
when (coalesce(current_setting('sollos.schedule_check', true), '') <> 'batch')
execute function public.check_booking_schedule_write();

drop trigger if exists booking_assignee_schedule_conflict_guard
  on public.booking_assignees;
create trigger booking_assignee_schedule_conflict_guard
after insert or update of
  organization_id, booking_id, membership_id,
  split_start_offset_minutes, split_duration_minutes
on public.booking_assignees
for each row
when (coalesce(current_setting('sollos.schedule_check', true), '') <> 'batch')
execute function public.check_booking_assignee_schedule_write();

-- Every clash these bookings have as they stand: one row per person on the
-- booking per other job her time overlaps. Windows and overlap are the
-- guard's own (booking_member_windows, booking_schedule_conflicts).
create or replace function public.booking_conflict_pairs(
  p_organization_id uuid,
  p_booking_ids uuid[]
)
returns table (pair_booking_id uuid, pair_membership_id uuid, pair_other_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b public.bookings%rowtype;
  w jsonb;
begin
  for b in
    select * from public.bookings x
    where x.organization_id = p_organization_id
      and x.id = any(p_booking_ids)
      and x.status <> 'cancelled'
  loop
    for w in
      select * from jsonb_array_elements(public.booking_member_windows(
        b.id, b.organization_id, b.scheduled_at, b.duration_minutes,
        b.splits, b.assigned_to, b.divide_hours_evenly, null
      ))
    loop
      return query
      select b.id, (w->>'membership_id')::uuid, t.id
      from public.booking_schedule_conflicts(p_organization_id, b.id, jsonb_build_array(w)) as t(id);
    end loop;
  end loop;
end;
$$;
revoke all on function public.booking_conflict_pairs(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.booking_conflict_pairs(uuid, uuid[]) to service_role;

-- What the guard cares about on these bookings: when each is, how its hours
-- are shared, and who is on it with which segment. Compared before and
-- after a save to tell a person whose time changed from one whose time did
-- not.
create or replace function public.booking_schedule_snapshot(
  p_organization_id uuid,
  p_booking_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(b.id::text, jsonb_build_object(
    'sched', jsonb_build_array(
      b.scheduled_at, b.duration_minutes, coalesce(b.splits, '[]'::jsonb),
      coalesce(b.divide_hours_evenly, false), b.status = 'cancelled'
    ),
    'crew', (
      select coalesce(jsonb_object_agg(c.membership_id::text, jsonb_build_array(c.off, c.dur)), '{}'::jsonb)
      from (
        select ba.membership_id, ba.split_start_offset_minutes as off, ba.split_duration_minutes as dur
        from public.booking_assignees ba
        where ba.booking_id = b.id
        union all
        select b.assigned_to, null::integer, null::integer
        where b.assigned_to is not null
          and not exists (
            select 1 from public.booking_assignees ba
            where ba.booking_id = b.id and ba.membership_id = b.assigned_to
          )
      ) c
    )
  )), '{}'::jsonb)
  from public.bookings b
  where b.organization_id = p_organization_id
    and b.id = any(p_booking_ids);
$$;
revoke all on function public.booking_schedule_snapshot(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.booking_schedule_snapshot(uuid, uuid[]) to service_role;

-- The question, asked once after a save: is there a clash now that was not
-- there before, for someone whose time on the job this save set or changed?
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
begin
  if exists (
    select 1
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
  ) then
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
end;
$$;
revoke all on function public.assert_no_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.assert_no_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb) to service_role;

-- update_booking_assignments_v2: the body that does the writing keeps its
-- code and moves to a new name; the old name becomes the wrapper that asks
-- the question around it. update_booking_series_with_assignees calls this
-- by name, so a "this and all future" save is covered by the same wrapper.
do $$
begin
  if to_regprocedure('public.update_booking_assignments_v2_apply(uuid, uuid[], jsonb, jsonb)') is null then
    alter function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
      rename to update_booking_assignments_v2_apply;
  end if;
end;
$$;
revoke all on function public.update_booking_assignments_v2_apply(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.update_booking_assignments_v2(
  p_organization_id uuid,
  p_booking_ids uuid[],
  p_booking_patch jsonb,
  p_assignees jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  before_state jsonb;
  before_pairs jsonb;
  already_deferred boolean := public.booking_schedule_check_deferred();
begin
  -- Bad input: let the writer say so in its own words.
  if p_organization_id is null or p_booking_ids is null then
    perform public.update_booking_assignments_v2_apply(p_organization_id, p_booking_ids, p_booking_patch, p_assignees);
    return;
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);
  before_state := public.booking_schedule_snapshot(p_organization_id, p_booking_ids);
  select coalesce(jsonb_agg(jsonb_build_object('b', p.pair_booking_id, 'm', p.pair_membership_id, 'o', p.pair_other_id)), '[]'::jsonb)
    into before_pairs
  from public.booking_conflict_pairs(p_organization_id, p_booking_ids) p;

  perform set_config('sollos.schedule_check', 'batch', true);
  perform public.update_booking_assignments_v2_apply(p_organization_id, p_booking_ids, p_booking_patch, p_assignees);
  if not already_deferred then
    perform set_config('sollos.schedule_check', '', true);
  end if;

  perform public.assert_no_new_schedule_conflicts(p_organization_id, p_booking_ids, before_state, before_pairs);
end;
$$;
revoke all on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  to service_role;

-- reschedule_booking_with_assignees (the scheduler's drag), the same way.
do $$
begin
  if to_regprocedure('public.reschedule_booking_with_assignees_apply(uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[])') is null then
    alter function public.reschedule_booking_with_assignees(
      uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
    ) rename to reschedule_booking_with_assignees_apply;
  end if;
end;
$$;
revoke all on function public.reschedule_booking_with_assignees_apply(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) from public, anon, authenticated, service_role;

create or replace function public.reschedule_booking_with_assignees(
  p_organization_id uuid,
  p_booking_id uuid,
  p_scheduled_at timestamptz,
  p_scheduled_local text,
  p_scheduled_tz text,
  p_set_assigned_to boolean,
  p_assigned_to uuid,
  p_reset_client_reminder boolean,
  p_time_set_by_hand_at timestamptz,
  p_assignee_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[] := array[p_booking_id];
  before_state jsonb;
  before_pairs jsonb;
  already_deferred boolean := public.booking_schedule_check_deferred();
begin
  if p_organization_id is null or p_booking_id is null then
    perform public.reschedule_booking_with_assignees_apply(
      p_organization_id, p_booking_id, p_scheduled_at, p_scheduled_local, p_scheduled_tz,
      p_set_assigned_to, p_assigned_to, p_reset_client_reminder, p_time_set_by_hand_at, p_assignee_ids
    );
    return;
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);
  before_state := public.booking_schedule_snapshot(p_organization_id, ids);
  select coalesce(jsonb_agg(jsonb_build_object('b', p.pair_booking_id, 'm', p.pair_membership_id, 'o', p.pair_other_id)), '[]'::jsonb)
    into before_pairs
  from public.booking_conflict_pairs(p_organization_id, ids) p;

  perform set_config('sollos.schedule_check', 'batch', true);
  perform public.reschedule_booking_with_assignees_apply(
    p_organization_id, p_booking_id, p_scheduled_at, p_scheduled_local, p_scheduled_tz,
    p_set_assigned_to, p_assigned_to, p_reset_client_reminder, p_time_set_by_hand_at, p_assignee_ids
  );
  if not already_deferred then
    perform set_config('sollos.schedule_check', '', true);
  end if;

  perform public.assert_no_new_schedule_conflicts(p_organization_id, ids, before_state, before_pairs);
end;
$$;
revoke all on function public.reschedule_booking_with_assignees(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) from public, anon, authenticated;
grant execute on function public.reschedule_booking_with_assignees(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) to service_role;

commit;

-- The API keeps a list of callable functions; tell it the list changed.
notify pgrst, 'reload schema';
