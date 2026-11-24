-- "Book anyway", where the office actually works: the scheduling board, and
-- the visits a series save left someone off.
--
-- WHY
-- 20261124020000 let an owner or admin keep an overlap from the booking
-- form. Svitlana moves visits by dragging them on the board (the busiest
-- write in the app), and that still refused. And her request was about a
-- series: Nella and Joe Cotesta, every three weeks on Thursday with Olha,
-- who has another client every second Thursday. The series save leaves
-- Olha off the clashing visits and marks them "Needs cover". She wanted
-- Olha kept on them, overlapping, so she could move each visit herself:
-- "it's just going to be overlapping, and then I can just move it locally."
--
-- NOW
--   reschedule_booking_with_assignees_allow_clashes
--     A board drag with the overlap allowed (sollos.crew_clash = 'allow',
--     read by assert_no_new_schedule_conflicts). The app calls it only
--     after the owner or admin has seen the clash and pressed Book anyway.
--
--   put_left_off_crew_on(org, booking ids)
--     For visits marked cover_needed: puts back everyone who was left off
--     for ANOTHER JOB, overlap and all, and clears their mark. Returns who
--     went back on which visit, so the app can tell them.
--
-- What neither waives: a cleaner after her last working day (20261124010000).
-- The drag still refuses her; put_left_off_crew_on leaves her off and
-- leaves her mark. Someone no longer active is left off too. A visit on
-- split times is left alone: each person's segment is written on the visit.
--
-- Run AFTER 20261124020000 and BEFORE the code push. Idempotent. Changes no
-- existing rows.

begin;

create or replace function public.reschedule_booking_with_assignees_allow_clashes(
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
begin
  perform set_config('sollos.crew_clash', 'allow', true);
  perform public.reschedule_booking_with_assignees(
    p_organization_id, p_booking_id, p_scheduled_at, p_scheduled_local, p_scheduled_tz,
    p_set_assigned_to, p_assigned_to, p_reset_client_reminder, p_time_set_by_hand_at, p_assignee_ids
  );
  perform set_config('sollos.crew_clash', '', true);
end;
$$;
revoke all on function public.reschedule_booking_with_assignees_allow_clashes(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) from public, anon, authenticated;
grant execute on function public.reschedule_booking_with_assignees_allow_clashes(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) to service_role;

create or replace function public.put_left_off_crew_on(
  p_organization_id uuid,
  p_booking_ids uuid[]
)
returns table (booking_id uuid, membership_id uuid, scheduled_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  already_deferred boolean := public.booking_schedule_check_deferred();
  r record;
  back uuid[];
  new_lead uuid;
  crew_rows jsonb;
  remaining jsonb;
  m uuid;
begin
  if p_organization_id is null or p_booking_ids is null then
    raise exception 'Invalid input' using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);
  -- The guard stands aside for these writes: the overlap is the point.
  -- The last working day is answered for below, person by person.
  perform set_config('sollos.schedule_check', 'batch', true);

  for r in
    select b.id, b.scheduled_at, b.assigned_to, b.cover_needed, b.splits
    from public.bookings b
    where b.organization_id = p_organization_id
      and b.id = any(p_booking_ids)
      and b.status in ('pending', 'confirmed')
      and jsonb_typeof(b.cover_needed) = 'array'
      and not (jsonb_typeof(b.splits) = 'array' and jsonb_array_length(b.splits) > 0)
    order by b.scheduled_at, b.id
  loop
    select array_agg(x.member_id order by x.first_seen)
      into back
    from (
      select (c.value ->> 'membership_id')::uuid as member_id, min(c.ordinality) as first_seen
      from jsonb_array_elements(r.cover_needed) with ordinality as c(value, ordinality)
      join public.memberships mem
        on mem.id = (c.value ->> 'membership_id')::uuid
       and mem.organization_id = p_organization_id
       and mem.status = 'active'
      -- The visit naming itself is "finished by then", not another job.
      where (c.value ->> 'other_booking_id') is distinct from r.id::text
        and not public.member_past_last_day(p_organization_id, mem.id, r.scheduled_at)
        and not exists (
          select 1 from public.booking_assignees ba
          where ba.booking_id = r.id and ba.membership_id = mem.id
        )
        and r.assigned_to is distinct from mem.id
      group by 1
    ) x;
    if back is null or cardinality(back) = 0 then
      continue;
    end if;

    -- Whoever leads now keeps leading; a visit with nobody takes the first
    -- person put back.
    new_lead := coalesce(
      r.assigned_to,
      (select ba.membership_id from public.booking_assignees ba
        where ba.booking_id = r.id
        order by ba.is_primary desc, ba.split_index nulls last, ba.membership_id
        limit 1),
      back[1]
    );

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
      into crew_rows
    from public.booking_assignees ba
    where ba.booking_id = r.id;

    -- A lead on the visit's own row with no crew row yet gets one.
    if r.assigned_to is not null and not exists (
      select 1 from public.booking_assignees ba
      where ba.booking_id = r.id and ba.membership_id = r.assigned_to
    ) then
      crew_rows := crew_rows || jsonb_build_array(jsonb_build_object(
        'booking_id', r.id, 'membership_id', r.assigned_to, 'is_primary', true
      ));
    end if;

    select crew_rows || coalesce(jsonb_agg(jsonb_build_object(
        'booking_id', r.id,
        'membership_id', b.member_id,
        'is_primary', b.member_id = new_lead
      )), '[]'::jsonb)
      into crew_rows
    from unnest(back) as b(member_id);

    perform public.update_booking_assignments_v2_apply(
      p_organization_id, array[r.id], jsonb_build_object('assigned_to', new_lead), crew_rows
    );

    select jsonb_agg(c.value order by c.ordinality)
      into remaining
    from jsonb_array_elements(r.cover_needed) with ordinality as c(value, ordinality)
    where not ((c.value ->> 'membership_id')::uuid = any(back));

    update public.bookings b
    set cover_needed = remaining
    where b.id = r.id
      and b.organization_id = p_organization_id;

    foreach m in array back loop
      booking_id := r.id;
      membership_id := m;
      scheduled_at := r.scheduled_at;
      return next;
    end loop;
  end loop;

  if not already_deferred then
    perform set_config('sollos.schedule_check', '', true);
  end if;
end;
$$;
revoke all on function public.put_left_off_crew_on(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.put_left_off_crew_on(uuid, uuid[]) to service_role;

commit;

notify pgrst, 'reload schema';
