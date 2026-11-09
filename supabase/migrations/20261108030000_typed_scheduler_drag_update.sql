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
  current_booking public.bookings%rowtype;
begin
  if p_organization_id is null
    or p_booking_id is null
    or p_scheduled_at is null
    or p_scheduled_local is null
    or p_scheduled_tz is null
    or p_set_assigned_to is null
    or p_reset_client_reminder is null
    or (
      p_reset_client_reminder
      and p_time_set_by_hand_at is null
    )
    or (
      p_set_assigned_to
      and p_assignee_ids is null
    )
    or (
      not p_set_assigned_to
      and p_assigned_to is not null
    )
  then
    raise exception 'Invalid scheduler booking update input'
      using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);

  select *
    into current_booking
  from public.bookings
  where id = p_booking_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Booking was not found in this organization'
      using errcode = 'P0002';
  end if;

  if p_set_assigned_to
    and p_assigned_to is not null
    and not exists (
      select 1
      from public.memberships m
      where m.id = p_assigned_to
        and m.organization_id = p_organization_id
        and m.status = 'active'
    )
  then
    raise exception 'Invalid or inactive primary booking assignee'
      using errcode = '22023';
  end if;

  if p_assignee_ids is not null and (
    cardinality(p_assignee_ids) <> (
      select count(distinct requested.membership_id)
      from unnest(p_assignee_ids) as requested(membership_id)
    )
    or exists (
      select 1
      from unnest(p_assignee_ids) as requested(membership_id)
      left join public.memberships m
        on m.id = requested.membership_id
       and m.organization_id = p_organization_id
       and m.status = 'active'
      where requested.membership_id is null
        or m.id is null
    )
    or (
      p_assigned_to is not null
      and not (p_assigned_to = any(p_assignee_ids))
    )
  ) then
    raise exception 'Invalid or duplicate booking assignee'
      using errcode = '22023';
  end if;

  if p_assignee_ids is not null then
    delete from public.booking_assignees
    where organization_id = p_organization_id
      and booking_id = p_booking_id
      and not (membership_id = any(p_assignee_ids));
  end if;

  update public.bookings b
  set scheduled_at = p_scheduled_at,
      scheduled_local = p_scheduled_local,
      scheduled_tz = p_scheduled_tz,
      assigned_to = case
        when p_set_assigned_to then p_assigned_to
        else b.assigned_to
      end,
      client_reminder_sent_at = case
        when p_reset_client_reminder then null
        else b.client_reminder_sent_at
      end,
      time_set_by_hand_at = case
        when p_reset_client_reminder then p_time_set_by_hand_at
        else b.time_set_by_hand_at
      end
  where b.id = p_booking_id
    and b.organization_id = p_organization_id;

  if p_assignee_ids is not null then
    insert into public.booking_assignees (
      organization_id,
      booking_id,
      membership_id,
      is_primary
    )
    select
      p_organization_id,
      p_booking_id,
      requested.membership_id,
      requested.membership_id = p_assigned_to
    from unnest(p_assignee_ids) as requested(membership_id)
    on conflict (booking_id, membership_id) do update
      set is_primary = excluded.is_primary;
  end if;
end;
$$;

revoke all on function public.reschedule_booking_with_assignees(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) from public, anon, authenticated;
grant execute on function public.reschedule_booking_with_assignees(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) to service_role;

comment on function public.reschedule_booking_with_assignees(
  uuid, uuid, timestamptz, text, text, boolean, uuid, boolean, timestamptz, uuid[]
) is
  'Atomically reschedules one booking and optionally replaces its crew without a JSON patch payload.';
