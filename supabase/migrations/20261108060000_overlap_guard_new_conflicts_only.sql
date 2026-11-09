-- The overlap guard refuses only overlaps a change creates, and reads crew
-- windows the way the app does.
--
-- 20261107020000 put a trigger on bookings and booking_assignees that raised
-- 23P01 whenever a cleaner's window touched another job. Three problems, all
-- live within a day:
--
--   1. update_booking_assignments_v2 deleted and re-inserted every crew row on
--      each save, and the assignee trigger fires on INSERT, so a booking whose
--      cleaner already overlapped another job could not have its price or
--      notes changed. 53 future Svit visits overlapped on the day it shipped.
--   2. Any write that touched such a booking failed — the nightly series
--      extension, the time re-derive, Restore — even when the overlap was
--      years old and the change made it no worse.
--   3. Every crew member was given the booking's full duration. With hours
--      shared across the crew (divide_hours_evenly, or the org's
--      divide_crew_hours setting) the app treats a 10-hour job for three
--      people as a 3h20m window each (teamMinutes in src/lib/job-state.ts);
--      the guard blocked each of them for ten hours.
--
-- Now: booking_member_windows builds a booking's windows with shared hours
-- applied; booking_schedule_conflicts names the other bookings a set of
-- windows overlaps; and both triggers raise only if the change adds a
-- conflicting booking that was not already in conflict before it. A new
-- booking, a new crew member, or an un-cancelled job is checked in full.
-- update_booking_assignments_v2 now keeps the crew rows that stay, so an
-- edit that doesn't touch the crew triggers no crew check at all.

-- Does this booking share its hours across the crew? Mirrors
-- isAutomationEnabled: the master switch must be on, then the key.
create or replace function public.booking_shares_hours(
  p_divide_hours_evenly boolean,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_divide_hours_evenly, false) or exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.automations_enabled is true
      and (o.automation_settings -> 'divide_crew_hours' ->> 'enabled') = 'true'
  );
$$;
revoke all on function public.booking_shares_hours(boolean, uuid) from public;

-- One window per person on a booking, for the given schedule values (the NEW
-- row, or the OLD one). Crew rows come from booking_assignees as they stand;
-- split segments in p_splits override a crew row for the same person.
-- p_skip_primary: when the lead is being replaced, the outgoing lead's
-- is_primary row is about to go and must not count.
create or replace function public.booking_member_windows(
  p_booking_id uuid,
  p_organization_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_splits jsonb,
  p_assigned_to uuid,
  p_divide_hours_evenly boolean,
  p_skip_primary uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  windows jsonb := '[]'::jsonb;
  split_ids uuid[] := array[]::uuid[];
  segs jsonb := case when jsonb_typeof(p_splits) = 'array' then p_splits else '[]'::jsonb end;
  seg jsonb;
  seg_member uuid;
  seg_offset integer;
  seg_duration integer;
  cumulative integer := 0;
  has_split boolean;
  crew_count integer;
  team_minutes integer;
  row_ba record;
  ba_offset integer;
  ba_duration integer;
begin
  if p_scheduled_at is null then
    return windows;
  end if;

  has_split := jsonb_array_length(segs) > 0 or (
    p_splits is null and exists (
      select 1 from public.booking_assignees ba
      where ba.booking_id = p_booking_id
        and (ba.split_start_offset_minutes is not null or ba.split_duration_minutes is not null)
    )
  );

  select count(*) into crew_count
  from (
    select ba.membership_id
    from public.booking_assignees ba
    where ba.booking_id = p_booking_id
      and not (p_skip_primary is not null and ba.is_primary and ba.membership_id = p_skip_primary)
    union
    select p_assigned_to where p_assigned_to is not null
    union
    select nullif(s ->> 'assigned_to', '')::uuid
    from jsonb_array_elements(segs) s
    where nullif(s ->> 'assigned_to', '') is not null
  ) crew;

  team_minutes := case
    when public.booking_shares_hours(p_divide_hours_evenly, p_organization_id) and crew_count >= 2
      then greatest(1, round(coalesce(p_duration_minutes, 0)::numeric / crew_count)::integer)
    else coalesce(p_duration_minutes, 0)
  end;

  for seg in select value from jsonb_array_elements(segs) loop
    seg_member := nullif(seg ->> 'assigned_to', '')::uuid;
    seg_duration := coalesce((seg ->> 'duration_minutes')::integer, 0);
    seg_offset := greatest(0, coalesce((seg ->> 'start_offset_minutes')::integer, cumulative));
    cumulative := cumulative + seg_duration;
    if seg_member is not null and seg_duration > 0 then
      split_ids := array_append(split_ids, seg_member);
      windows := windows || jsonb_build_array(jsonb_build_object(
        'membership_id', seg_member,
        'start_at', p_scheduled_at + seg_offset * interval '1 minute',
        'end_at', p_scheduled_at + (seg_offset + seg_duration) * interval '1 minute'
      ));
    end if;
  end loop;

  for row_ba in
    select membership_id, is_primary, split_start_offset_minutes, split_duration_minutes
    from public.booking_assignees
    where booking_id = p_booking_id
  loop
    continue when row_ba.membership_id = any(split_ids);
    continue when p_skip_primary is not null and row_ba.is_primary and row_ba.membership_id = p_skip_primary;
    ba_offset := case when has_split then greatest(0, coalesce(row_ba.split_start_offset_minutes, 0)) else 0 end;
    ba_duration := case
      when has_split and row_ba.split_duration_minutes is not null then greatest(0, row_ba.split_duration_minutes)
      else team_minutes
    end;
    continue when ba_duration <= 0;
    windows := windows || jsonb_build_array(jsonb_build_object(
      'membership_id', row_ba.membership_id,
      'start_at', p_scheduled_at + ba_offset * interval '1 minute',
      'end_at', p_scheduled_at + (ba_offset + ba_duration) * interval '1 minute'
    ));
  end loop;

  if p_assigned_to is not null
    and team_minutes > 0
    and not (p_assigned_to = any(split_ids))
    and not exists (
      select 1 from public.booking_assignees ba
      where ba.booking_id = p_booking_id
        and ba.membership_id = p_assigned_to
        and not (p_skip_primary is not null and ba.is_primary and ba.membership_id = p_skip_primary)
    )
  then
    windows := windows || jsonb_build_array(jsonb_build_object(
      'membership_id', p_assigned_to,
      'start_at', p_scheduled_at,
      'end_at', p_scheduled_at + team_minutes * interval '1 minute'
    ));
  end if;

  return windows;
end;
$$;
revoke all on function public.booking_member_windows(uuid, uuid, timestamptz, integer, jsonb, uuid, boolean, uuid) from public;

-- The other bookings a set of proposed windows overlaps, each booking's crew
-- windows built the same way (shared hours applied).
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
  select distinct w.booking_id
  from member_windows w
  join jsonb_to_recordset(p_proposed_windows) as p(membership_id uuid, start_at timestamptz, end_at timestamptz)
    on p.membership_id = w.membership_id
   and w.s < w.e
   and w.s < p.end_at
   and w.e > p.start_at;
end;
$$;
revoke all on function public.booking_schedule_conflicts(uuid, uuid, jsonb) from public;

-- Kept for callers of the boolean form; now one rule, not two copies.
create or replace function public.booking_schedule_windows_conflict(
  p_organization_id uuid,
  p_booking_id uuid,
  p_proposed_windows jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.booking_schedule_conflicts(p_organization_id, p_booking_id, p_proposed_windows)
  );
$$;

create or replace function public.booking_schedule_has_conflict(
  p_organization_id uuid,
  p_booking_id uuid,
  p_proposed_windows jsonb
)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not public.current_user_has_role(
    p_organization_id,
    array['owner', 'admin']::public.membership_role[]
  ) then
    raise exception 'Not authorized to check this schedule' using errcode = '42501';
  end if;
  return public.booking_schedule_windows_conflict(p_organization_id, p_booking_id, p_proposed_windows);
end;
$$;

-- bookings: refuse only a conflict this change creates.
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

  if exists (
    select t.id from public.booking_schedule_conflicts(new.organization_id, new.id, new_windows) as t(id)
    except
    select t.id from public.booking_schedule_conflicts(new.organization_id, new.id, old_windows) as t(id)
  ) then
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.check_booking_schedule_write() from public;

-- booking_assignees: a new person is checked in full; a changed segment only
-- for conflicts it adds.
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

  if exists (
    select t.id from public.booking_schedule_conflicts(parent.organization_id, parent.id, new_window) as t(id)
    except
    select t.id from public.booking_schedule_conflicts(parent.organization_id, parent.id, old_window) as t(id)
  ) then
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.check_booking_assignee_schedule_write() from public;

-- Saving a booking keeps the crew rows that stay. Deleting and re-inserting
-- every row put each cleaner through the assignee trigger on every save, so
-- an unrelated edit was refused for an overlap it didn't cause. Removed
-- people are deleted, the rest are upserted in place; the one-primary index
-- is cleared first so swapping the lead among people who stay can't collide.
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
begin
  if p_organization_id is null
    or p_booking_ids is null
    or cardinality(p_booking_ids) = 0
    or p_booking_patch is null
    or jsonb_typeof(p_booking_patch) is distinct from 'object'
    or (
      p_assignees is not null
      and jsonb_typeof(p_assignees) is distinct from 'array'
    )
  then
    raise exception 'Invalid booking assignment update input'
      using errcode = '22023';
  end if;
  if cardinality(p_booking_ids) <> (
    select count(distinct requested.booking_id)
    from unnest(p_booking_ids) as requested(booking_id)
  )
    or exists (
      select 1
      from unnest(p_booking_ids) as requested(booking_id)
      left join public.bookings b
        on b.id = requested.booking_id
       and b.organization_id = p_organization_id
      where requested.booking_id is null
        or b.id is null
    )
  then
    raise exception 'A booking was not found in this organization'
      using errcode = 'P0002';
  end if;
  if (
    p_booking_patch
    - array[
      'client_id', 'assigned_to', 'scheduled_at', 'scheduled_local',
      'scheduled_tz', 'duration_minutes', 'service_type_id',
      'service_type_label', 'status', 'closed_at', 'closed_by',
      'total_cents', 'address', 'property_id', 'notes',
      'divide_hours_evenly', 'is_free', 'splits',
      'client_reminder_sent_at', 'time_set_by_hand_at'
    ]::text[]
  ) <> '{}'::jsonb then
    raise exception 'Invalid booking assignment update fields'
      using errcode = '22023';
  end if;
  if p_assignees is not null and exists (
    select 1
    from jsonb_to_recordset(p_assignees) as assignment(
      booking_id uuid,
      membership_id uuid,
      is_primary boolean
    )
    left join public.memberships m
      on m.id = assignment.membership_id
     and m.organization_id = p_organization_id
     and m.status = 'active'
    where assignment.booking_id is null
      or not (assignment.booking_id = any(p_booking_ids))
      or assignment.membership_id is null
      or assignment.is_primary is null
      or m.id is null
  ) then
    raise exception 'Invalid or inactive booking assignee'
      using errcode = '22023';
  end if;
  if p_assignees is not null and exists (
    select 1
    from jsonb_to_recordset(p_assignees) as assignment(booking_id uuid, membership_id uuid)
    group by assignment.booking_id, assignment.membership_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate booking assignee'
      using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);

  if p_assignees is not null then
    delete from public.booking_assignees ba
    where ba.organization_id = p_organization_id
      and ba.booking_id = any(p_booking_ids)
      and not exists (
        select 1
        from jsonb_to_recordset(p_assignees) as assignment(booking_id uuid, membership_id uuid)
        where assignment.booking_id = ba.booking_id
          and assignment.membership_id = ba.membership_id
      );
    -- is_primary is not a column the assignee trigger watches.
    update public.booking_assignees
    set is_primary = false
    where organization_id = p_organization_id
      and booking_id = any(p_booking_ids)
      and is_primary;
  end if;

  update public.bookings b
  set client_id = case when p_booking_patch ? 'client_id'
        then (p_booking_patch->>'client_id')::uuid else b.client_id end,
      assigned_to = case when p_booking_patch ? 'assigned_to'
        then (p_booking_patch->>'assigned_to')::uuid else b.assigned_to end,
      scheduled_at = case when p_booking_patch ? 'scheduled_at'
        then (p_booking_patch->>'scheduled_at')::timestamptz else b.scheduled_at end,
      scheduled_local = case when p_booking_patch ? 'scheduled_local'
        then p_booking_patch->>'scheduled_local' else b.scheduled_local end,
      scheduled_tz = case when p_booking_patch ? 'scheduled_tz'
        then p_booking_patch->>'scheduled_tz' else b.scheduled_tz end,
      duration_minutes = case when p_booking_patch ? 'duration_minutes'
        then (p_booking_patch->>'duration_minutes')::integer else b.duration_minutes end,
      service_type_id = case when p_booking_patch ? 'service_type_id'
        then (p_booking_patch->>'service_type_id')::uuid else b.service_type_id end,
      service_type_label = case when p_booking_patch ? 'service_type_label'
        then p_booking_patch->>'service_type_label' else b.service_type_label end,
      status = case when p_booking_patch ? 'status'
        then (p_booking_patch->>'status')::public.booking_status else b.status end,
      closed_at = case when p_booking_patch ? 'closed_at'
        then (p_booking_patch->>'closed_at')::timestamptz else b.closed_at end,
      closed_by = case when p_booking_patch ? 'closed_by'
        then (p_booking_patch->>'closed_by')::uuid else b.closed_by end,
      total_cents = case when p_booking_patch ? 'total_cents'
        then (p_booking_patch->>'total_cents')::integer else b.total_cents end,
      address = case when p_booking_patch ? 'address'
        then p_booking_patch->>'address' else b.address end,
      property_id = case when p_booking_patch ? 'property_id'
        then (p_booking_patch->>'property_id')::uuid else b.property_id end,
      notes = case when p_booking_patch ? 'notes'
        then p_booking_patch->>'notes' else b.notes end,
      divide_hours_evenly = case when p_booking_patch ? 'divide_hours_evenly'
        then (p_booking_patch->>'divide_hours_evenly')::boolean else b.divide_hours_evenly end,
      is_free = case when p_booking_patch ? 'is_free'
        then (p_booking_patch->>'is_free')::boolean else b.is_free end,
      splits = case when p_booking_patch ? 'splits'
        then p_booking_patch->'splits' else b.splits end,
      client_reminder_sent_at = case when p_booking_patch ? 'client_reminder_sent_at'
        then (p_booking_patch->>'client_reminder_sent_at')::timestamptz else b.client_reminder_sent_at end,
      time_set_by_hand_at = case when p_booking_patch ? 'time_set_by_hand_at'
        then (p_booking_patch->>'time_set_by_hand_at')::timestamptz else b.time_set_by_hand_at end
  from unnest(p_booking_ids) as requested(booking_id)
  where b.id = requested.booking_id
    and b.organization_id = p_organization_id
    and p_booking_patch <> '{}'::jsonb;

  if p_assignees is not null and exists (
    select 1
    from jsonb_to_recordset(p_assignees) as assignment(booking_id uuid, membership_id uuid, is_primary boolean)
    join public.bookings b
      on b.id = assignment.booking_id
     and b.organization_id = p_organization_id
    where assignment.is_primary
    group by b.id, b.assigned_to
    having count(*) > 1
      or bool_or(assignment.membership_id is distinct from b.assigned_to)
  ) then
    raise exception 'Primary booking assignee does not match the booking'
      using errcode = '22023';
  end if;
  if p_assignees is not null and exists (
    select 1
    from unnest(p_booking_ids) as requested(booking_id)
    join public.bookings b
      on b.id = requested.booking_id
     and b.organization_id = p_organization_id
    where b.assigned_to is not null
      and not exists (
        select 1
        from jsonb_to_recordset(p_assignees) as assignment(booking_id uuid, membership_id uuid, is_primary boolean)
        where assignment.booking_id = b.id
          and assignment.is_primary
          and assignment.membership_id = b.assigned_to
      )
  ) then
    raise exception 'Primary booking assignee is missing'
      using errcode = '22023';
  end if;

  if p_assignees is not null then
    insert into public.booking_assignees as existing (
      organization_id,
      booking_id,
      membership_id,
      is_primary,
      split_index,
      split_start_offset_minutes,
      split_duration_minutes,
      acceptance_status,
      responded_at,
      completed_at
    )
    select
      p_organization_id,
      assignment.booking_id,
      assignment.membership_id,
      assignment.is_primary,
      assignment.split_index,
      assignment.split_start_offset_minutes,
      assignment.split_duration_minutes,
      coalesce(assignment.acceptance_status, 'pending'),
      assignment.responded_at,
      assignment.completed_at
    from jsonb_to_recordset(p_assignees) as assignment(
      booking_id uuid,
      membership_id uuid,
      is_primary boolean,
      split_index integer,
      split_start_offset_minutes integer,
      split_duration_minutes integer,
      acceptance_status text,
      responded_at timestamptz,
      completed_at timestamptz
    )
    on conflict (booking_id, membership_id) do update
      set is_primary = excluded.is_primary,
          split_index = excluded.split_index,
          split_start_offset_minutes = excluded.split_start_offset_minutes,
          split_duration_minutes = excluded.split_duration_minutes,
          acceptance_status = excluded.acceptance_status,
          responded_at = excluded.responded_at,
          completed_at = excluded.completed_at;
  end if;
end;
$$;
revoke all on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  to service_role;
