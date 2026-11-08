create or replace function public.replace_future_series_bookings(
  p_organization_id uuid,
  p_series_id uuid,
  p_current_booking_id uuid,
  p_from timestamptz,
  p_booking_rows jsonb,
  p_additional_assignee_ids uuid[] default '{}'::uuid[]
)
returns table (
  operation text,
  id uuid,
  scheduled_at timestamptz,
  google_calendar_event_id text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  series_client_id uuid;
  deleted_rows jsonb := '[]'::jsonb;
begin
  if p_organization_id is null
    or p_series_id is null
    or p_current_booking_id is null
    or p_from is null
    or jsonb_typeof(p_booking_rows) is distinct from 'array'
  then
    raise exception 'Invalid recurring schedule replacement input'
      using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);

  select client_id
    into series_client_id
  from public.booking_series
  where id = p_series_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'Recurring series not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.bookings current_booking
    where current_booking.id = p_current_booking_id
      and current_booking.organization_id = p_organization_id
      and current_booking.series_id = p_series_id
  ) then
    raise exception 'Current booking does not belong to this recurring series'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_booking_rows) as proposed(
      client_id uuid,
      scheduled_at timestamptz,
      duration_minutes integer,
      service_type public.service_type,
      status public.booking_status
    )
    where proposed.client_id is distinct from series_client_id
      or proposed.scheduled_at is null
      or proposed.scheduled_at <= p_from
      or proposed.duration_minutes is null
      or proposed.duration_minutes <= 0
      or proposed.service_type is null
      or proposed.status is distinct from 'confirmed'::public.booking_status
  ) then
    raise exception 'Invalid booking in recurring schedule replacement'
      using errcode = '22023';
  end if;

  with deleted_bookings as (
    delete from public.bookings old_booking
    where old_booking.series_id = p_series_id
      and old_booking.organization_id = p_organization_id
      and old_booking.id <> p_current_booking_id
      and old_booking.scheduled_at >= p_from
      and old_booking.status in ('pending', 'confirmed')
    returning
      old_booking.id,
      old_booking.scheduled_at,
      old_booking.google_calendar_event_id
  )
  select coalesce(jsonb_agg(to_jsonb(deleted_bookings)), '[]'::jsonb)
    into deleted_rows
  from deleted_bookings;

  return query
  with proposed as (
    select *
    from jsonb_to_recordset(p_booking_rows) as row_data(
      client_id uuid,
      assigned_to uuid,
      scheduled_at timestamptz,
      duration_minutes integer,
      service_type public.service_type,
      service_type_id uuid,
      service_type_label text,
      status public.booking_status,
      total_cents integer,
      address text,
      property_id uuid,
      notes text,
      splits jsonb
    )
  ),
  inserted_bookings as (
    insert into public.bookings as created (
      organization_id,
      client_id,
      assigned_to,
      scheduled_at,
      duration_minutes,
      service_type,
      service_type_id,
      service_type_label,
      status,
      total_cents,
      address,
      property_id,
      notes,
      splits,
      series_id
    )
    select
      p_organization_id,
      proposed.client_id,
      proposed.assigned_to,
      proposed.scheduled_at,
      proposed.duration_minutes,
      proposed.service_type,
      proposed.service_type_id,
      proposed.service_type_label,
      proposed.status,
      proposed.total_cents,
      proposed.address,
      proposed.property_id,
      proposed.notes,
      coalesce(proposed.splits, '[]'::jsonb),
      p_series_id
    from proposed
    on conflict (series_id, scheduled_at) do nothing
    returning
      created.id,
      created.organization_id,
      created.scheduled_at,
      created.assigned_to,
      created.splits
  ),
  split_rows as (
    select
      booking.id as booking_id,
      booking.organization_id,
      nullif(split.value ->> 'assigned_to', '')::uuid as membership_id,
      (split.ordinality - 1)::integer as split_index,
      greatest(
        0,
        coalesce(nullif(split.value ->> 'duration_minutes', '')::integer, 0)
      ) as split_duration_minutes,
      nullif(split.value ->> 'start_offset_minutes', '')::integer
        as explicit_start_offset,
      sum(greatest(
        0,
        coalesce(nullif(split.value ->> 'duration_minutes', '')::integer, 0)
      )) over (
        partition by booking.id
        order by split.ordinality
        rows between unbounded preceding and 1 preceding
      ) as prior_duration
    from inserted_bookings booking
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(booking.splits) = 'array' then booking.splits
        else '[]'::jsonb
      end
    ) with ordinality as split(value, ordinality)
  ),
  assignments as (
    select
      split.booking_id,
      split.organization_id,
      split.membership_id,
      split.split_index = 0 as is_primary,
      split.split_index,
      coalesce(split.explicit_start_offset, split.prior_duration, 0)::integer
        as split_start_offset_minutes,
      split.split_duration_minutes
    from split_rows split
    where split.membership_id is not null

    union all

    select
      booking.id,
      booking.organization_id,
      booking.assigned_to,
      true,
      null::integer,
      null::integer,
      null::integer
    from inserted_bookings booking
    where booking.assigned_to is not null
      and jsonb_array_length(
        case
          when jsonb_typeof(booking.splits) = 'array' then booking.splits
          else '[]'::jsonb
        end
      ) = 0

    union all

    select
      booking.id,
      booking.organization_id,
      additional.membership_id,
      false,
      null::integer,
      null::integer,
      null::integer
    from inserted_bookings booking
    cross join (
      select distinct unnest(coalesce(
        p_additional_assignee_ids,
        '{}'::uuid[]
      )) as membership_id
    ) additional
    where not exists (
      select 1
      from split_rows split
      where split.booking_id = booking.id
        and split.membership_id = additional.membership_id
    )
      and additional.membership_id is distinct from booking.assigned_to
  ),
  inserted_assignees as (
    insert into public.booking_assignees (
      organization_id,
      booking_id,
      membership_id,
      is_primary,
      split_index,
      split_start_offset_minutes,
      split_duration_minutes
    )
    select
      assignment.organization_id,
      assignment.booking_id,
      assignment.membership_id,
      assignment.is_primary,
      assignment.split_index,
      assignment.split_start_offset_minutes,
      assignment.split_duration_minutes
    from assignments assignment
    join public.memberships member
      on member.id = assignment.membership_id
      and member.organization_id = assignment.organization_id
      and member.status = 'active'
    on conflict (booking_id, membership_id) do nothing
    returning booking_id
  )
  select
    'inserted'::text,
    booking.id,
    booking.scheduled_at,
    null::text
  from inserted_bookings booking
  cross join (select count(*) from inserted_assignees) ensure_assignees_ran;

  return query
  select
    'deleted'::text,
    deleted.id,
    deleted.scheduled_at,
    deleted.google_calendar_event_id
  from jsonb_to_recordset(deleted_rows) as deleted(
    id uuid,
    scheduled_at timestamptz,
    google_calendar_event_id text
  );
end;
$$;

revoke all on function public.replace_future_series_bookings(
  uuid, uuid, uuid, timestamptz, jsonb, uuid[]
) from public, anon, authenticated;
grant execute on function public.replace_future_series_bookings(
  uuid, uuid, uuid, timestamptz, jsonb, uuid[]
) to service_role;

comment on function public.replace_future_series_bookings(
  uuid, uuid, uuid, timestamptz, jsonb, uuid[]
) is
  'Atomically replaces pending and confirmed future occurrences, including crew, so schedule-trigger failures preserve the previous series.';

notify pgrst, 'reload schema';
