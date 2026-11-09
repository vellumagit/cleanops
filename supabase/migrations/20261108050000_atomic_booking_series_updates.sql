create or replace function public.update_booking_series_with_assignees(
  p_organization_id uuid,
  p_series_id uuid,
  p_current_booking_id uuid,
  p_from timestamptz,
  p_current_booking_patch jsonb,
  p_current_assignees jsonb,
  p_sibling_booking_patch jsonb,
  p_series_patch jsonb,
  p_replace_schedule boolean default false,
  p_booking_rows jsonb default '[]'::jsonb,
  p_additional_assignee_ids uuid[] default '{}'::uuid[]
)
returns table (
  operation text,
  id uuid,
  scheduled_at timestamptz,
  google_calendar_event_id text,
  status public.booking_status
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  sibling_ids uuid[];
  sibling_assignees jsonb;
begin
  if p_organization_id is null
    or p_series_id is null
    or p_current_booking_id is null
    or p_from is null
    or p_current_booking_patch is null
    or jsonb_typeof(p_current_booking_patch) is distinct from 'object'
    or p_current_assignees is null
    or jsonb_typeof(p_current_assignees) is distinct from 'array'
    or p_sibling_booking_patch is null
    or jsonb_typeof(p_sibling_booking_patch) is distinct from 'object'
    or p_series_patch is null
    or jsonb_typeof(p_series_patch) is distinct from 'object'
    or (p_replace_schedule and jsonb_typeof(p_booking_rows) is distinct from 'array')
  then
    raise exception 'Invalid recurring booking update input'
      using errcode = '22023';
  end if;

  if (
    p_series_patch
    - array[
      'duration_minutes', 'service_type_id', 'service_type_label',
      'total_cents', 'assigned_to', 'address', 'property_id', 'notes',
      'crew', 'pattern', 'start_time', 'starts_at', 'ends_at',
      'custom_days', 'monthly_nth', 'monthly_dow'
    ]::text[]
  ) <> '{}'::jsonb then
    raise exception 'Invalid recurring series update fields'
      using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);

  if not exists (
    select 1
    from public.booking_series series
    where series.id = p_series_id
      and series.organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.bookings current_booking
    where current_booking.id = p_current_booking_id
      and current_booking.organization_id = p_organization_id
      and current_booking.series_id = p_series_id
  ) then
    raise exception 'Recurring series or current booking was not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_current_assignees) as assignment(
      booking_id uuid,
      membership_id uuid
    )
    where assignment.booking_id is distinct from p_current_booking_id
  ) then
    raise exception 'Current assignees do not match the booking'
      using errcode = '22023';
  end if;

  perform public.update_booking_assignments_v2(
    p_organization_id,
    array[p_current_booking_id],
    p_current_booking_patch,
    p_current_assignees
  );

  if p_replace_schedule then
    return query
    select
      replaced.operation,
      replaced.id,
      replaced.scheduled_at,
      replaced.google_calendar_event_id,
      null::public.booking_status
    from public.replace_future_series_bookings(
      p_organization_id,
      p_series_id,
      p_current_booking_id,
      p_from,
      p_booking_rows,
      p_additional_assignee_ids
    ) as replaced;
  else
    select coalesce(array_agg(b.id), '{}'::uuid[])
      into sibling_ids
    from public.bookings b
    where b.series_id = p_series_id
      and b.organization_id = p_organization_id
      and b.id <> p_current_booking_id
      and b.scheduled_at >= p_from
      and b.status not in ('completed', 'cancelled');

    if cardinality(sibling_ids) > 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
        'booking_id', sibling.id,
        'membership_id', template.membership_id,
        'is_primary', template.is_primary,
        'split_index', template.split_index,
        'split_start_offset_minutes', template.split_start_offset_minutes,
        'split_duration_minutes', template.split_duration_minutes,
        'acceptance_status', coalesce(prior.acceptance_status, 'pending'),
        'responded_at', prior.responded_at,
        'completed_at', prior.completed_at
      )), '[]'::jsonb)
        into sibling_assignees
      from unnest(sibling_ids) as sibling(id)
      cross join jsonb_to_recordset(p_current_assignees) as template(
        booking_id uuid,
        membership_id uuid,
        is_primary boolean,
        split_index integer,
        split_start_offset_minutes integer,
        split_duration_minutes integer
      )
      left join public.booking_assignees prior
        on prior.booking_id = sibling.id
       and prior.membership_id = template.membership_id;

      perform public.update_booking_assignments_v2(
        p_organization_id,
        sibling_ids,
        p_sibling_booking_patch,
        sibling_assignees
      );

      return query
      select 'updated'::text, b.id, b.scheduled_at,
        null::text, b.status
      from public.bookings b
      where b.id = any(sibling_ids)
        and b.organization_id = p_organization_id;
    end if;
  end if;

  update public.booking_series series
  set duration_minutes = case when p_series_patch ? 'duration_minutes'
        then (p_series_patch->>'duration_minutes')::integer else series.duration_minutes end,
      service_type_id = case when p_series_patch ? 'service_type_id'
        then (p_series_patch->>'service_type_id')::uuid else series.service_type_id end,
      service_type_label = case when p_series_patch ? 'service_type_label'
        then p_series_patch->>'service_type_label' else series.service_type_label end,
      total_cents = case when p_series_patch ? 'total_cents'
        then (p_series_patch->>'total_cents')::integer else series.total_cents end,
      assigned_to = case when p_series_patch ? 'assigned_to'
        then (p_series_patch->>'assigned_to')::uuid else series.assigned_to end,
      address = case when p_series_patch ? 'address'
        then p_series_patch->>'address' else series.address end,
      property_id = case when p_series_patch ? 'property_id'
        then (p_series_patch->>'property_id')::uuid else series.property_id end,
      notes = case when p_series_patch ? 'notes'
        then p_series_patch->>'notes' else series.notes end,
      crew = case when p_series_patch ? 'crew'
        then p_series_patch->'crew' else series.crew end,
      pattern = case when p_series_patch ? 'pattern'
        then p_series_patch->>'pattern' else series.pattern end,
      start_time = case when p_series_patch ? 'start_time'
        then (p_series_patch->>'start_time')::time else series.start_time end,
      starts_at = case when p_series_patch ? 'starts_at'
        then (p_series_patch->>'starts_at')::date else series.starts_at end,
      ends_at = case when p_series_patch ? 'ends_at'
        then (p_series_patch->>'ends_at')::date else series.ends_at end,
      custom_days = case when p_series_patch ? 'custom_days'
        then case
          when jsonb_typeof(p_series_patch->'custom_days') = 'array'
            then array(
              select jsonb_array_elements_text(p_series_patch->'custom_days')::smallint
            )
          else null
        end
        else series.custom_days end,
      monthly_nth = case when p_series_patch ? 'monthly_nth'
        then (p_series_patch->>'monthly_nth')::smallint else series.monthly_nth end,
      monthly_dow = case when p_series_patch ? 'monthly_dow'
        then (p_series_patch->>'monthly_dow')::smallint else series.monthly_dow end
  where series.id = p_series_id
    and series.organization_id = p_organization_id;

  if not found then
    raise exception 'Recurring series was not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_booking_series_with_assignees(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[]
) from public, anon, authenticated;
grant execute on function public.update_booking_series_with_assignees(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[]
) to service_role;

comment on function public.update_booking_series_with_assignees(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[]
) is
  'Atomically updates a recurring booking, its future visits, and its template.';

notify pgrst, 'reload schema';
