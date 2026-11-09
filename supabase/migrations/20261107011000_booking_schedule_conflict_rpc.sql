-- Check proposed assignment windows against non-cancelled assignments for the
-- same cleaners. This avoids calendar-day filters and PostgREST row limits.
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
    raise exception 'Not authorized to check this schedule'
      using errcode = '42501';
  end if;

  if p_organization_id is null
    or p_booking_id is null
    or jsonb_typeof(p_proposed_windows) is distinct from 'array'
  then
    raise exception 'Invalid schedule conflict check input'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_proposed_windows) as proposed(
      membership_id uuid,
      start_at timestamptz,
      end_at timestamptz
    )
    where proposed.membership_id is null
      or proposed.start_at is null
      or proposed.end_at is null
      or proposed.start_at >= proposed.end_at
  ) then
    raise exception 'Invalid proposed schedule window'
      using errcode = '22023';
  end if;

  return exists (
    select 1
    from jsonb_to_recordset(p_proposed_windows) as proposed(
      membership_id uuid,
      start_at timestamptz,
      end_at timestamptz
    )
    where exists (
      select 1
      from public.booking_assignees ba
      join public.bookings b on b.id = ba.booking_id
      where ba.membership_id = proposed.membership_id
        and b.organization_id = p_organization_id
        and b.id <> p_booking_id
        and b.status <> 'cancelled'
        and b.scheduled_at
          + coalesce(ba.split_start_offset_minutes, 0)::double precision
            * interval '1 minute'
          < proposed.end_at
        and b.scheduled_at
          + (
            coalesce(ba.split_start_offset_minutes, 0)::double precision
            + coalesce(
              ba.split_duration_minutes,
              b.duration_minutes
            )::double precision
          ) * interval '1 minute'
          > proposed.start_at
    )
    or exists (
      select 1
      from public.bookings b
      where b.assigned_to = proposed.membership_id
        and b.organization_id = p_organization_id
        and b.id <> p_booking_id
        and b.status <> 'cancelled'
        and b.scheduled_at < proposed.end_at
        and b.scheduled_at
          + b.duration_minutes::double precision * interval '1 minute'
          > proposed.start_at
        and not exists (
          select 1
          from public.booking_assignees ba
          where ba.booking_id = b.id
            and ba.membership_id = proposed.membership_id
        )
    )
  );
end;
$$;

revoke all on function public.booking_schedule_has_conflict(uuid, uuid, jsonb)
  from public;
grant execute on function public.booking_schedule_has_conflict(uuid, uuid, jsonb)
  to authenticated;

comment on function public.booking_schedule_has_conflict(uuid, uuid, jsonb) is
  'Checks proposed cleaner time windows against non-cancelled bookings, including split assignments and legacy primary assignments.';
