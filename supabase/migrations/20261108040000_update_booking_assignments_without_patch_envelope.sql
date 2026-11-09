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
      is_primary boolean,
      split_index integer,
      split_start_offset_minutes integer,
      split_duration_minutes integer,
      acceptance_status text,
      responded_at timestamptz,
      completed_at timestamptz
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
    group by assignment.booking_id, assignment.membership_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate booking assignee'
      using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);

  if p_assignees is not null then
    delete from public.booking_assignees
    where organization_id = p_organization_id
      and booking_id = any(p_booking_ids);
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
        where assignment.booking_id = b.id
          and assignment.is_primary
          and assignment.membership_id = b.assigned_to
      )
  ) then
    raise exception 'Primary booking assignee is missing'
      using errcode = '22023';
  end if;

  if p_assignees is not null then
    insert into public.booking_assignees (
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
      assignment.acceptance_status,
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
    );
  end if;
end;
$$;

revoke all on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  to service_role;

comment on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb) is
  'Atomically update shared booking fields and replace assignees without a nested JSON patch envelope.';
