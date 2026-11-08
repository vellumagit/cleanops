-- Serialize schedule-affecting writes per organization. The lock is held until
-- the surrounding Postgres transaction commits, so a concurrent writer checks
-- against the first writer's committed assignment rather than the old state.
-- One org-level lock avoids inconsistent lock ordering for multi-cleaner jobs.
create or replace function public.lock_booking_schedule_writes(p_organization_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text, 4815162342)
  );
end;
$$;

revoke all on function public.lock_booking_schedule_writes(uuid) from public;

create or replace function public.booking_schedule_windows_conflict(
  p_organization_id uuid,
  p_booking_id uuid,
  p_proposed_windows jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_proposed_windows) is distinct from 'array' then
    raise exception 'Invalid proposed schedule windows'
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
          + greatest(0, coalesce(ba.split_start_offset_minutes, 0))::double precision
            * interval '1 minute'
          < proposed.end_at
        and b.scheduled_at
          + (
            greatest(0, coalesce(ba.split_start_offset_minutes, 0))::double precision
            + greatest(
              0,
              coalesce(ba.split_duration_minutes, b.duration_minutes)
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

revoke all on function public.booking_schedule_windows_conflict(uuid, uuid, jsonb)
  from public;

create or replace function public.check_booking_schedule_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  windows jsonb := '[]'::jsonb;
  split_ids uuid[] := array[]::uuid[];
  segment jsonb;
  segment_membership uuid;
  segment_offset bigint;
  segment_duration bigint;
  cumulative_offset bigint := 0;
  old_assigned_to uuid;
  ba record;
  has_split boolean := false;
begin
  if tg_op = 'UPDATE' then
    old_assigned_to := old.assigned_to;
    if new.scheduled_at is not distinct from old.scheduled_at
      and new.duration_minutes is not distinct from old.duration_minutes
      and new.assigned_to is not distinct from old.assigned_to
      and new.splits is not distinct from old.splits
      and new.organization_id is not distinct from old.organization_id
      and (
        new.status = 'cancelled'
        or old.status <> 'cancelled'
      )
    then
      return new;
    end if;
  end if;

  if new.status = 'cancelled' then
    return new;
  end if;

  perform public.lock_booking_schedule_writes(new.organization_id);

  has_split := case
    when jsonb_typeof(new.splits) = 'array'
      then jsonb_array_length(new.splits) > 0
    else false
  end or (
    new.splits is null
    and exists (
      select 1
      from public.booking_assignees ba
      where ba.booking_id = new.id
        and (
          ba.split_start_offset_minutes is not null
          or ba.split_duration_minutes is not null
        )
    )
  );

  if has_split and jsonb_typeof(new.splits) = 'array' then
    for segment in
      select value from jsonb_array_elements(new.splits)
    loop
      segment_membership := nullif(segment->>'assigned_to', '')::uuid;
      segment_duration := coalesce((segment->>'duration_minutes')::bigint, 0);
      segment_offset := coalesce(
        (segment->>'start_offset_minutes')::bigint,
        cumulative_offset
      );
      cumulative_offset := cumulative_offset + segment_duration;

      if segment_membership is not null and segment_duration > 0 then
        split_ids := array_append(split_ids, segment_membership);
        windows := windows || jsonb_build_array(jsonb_build_object(
          'membership_id', segment_membership,
          'start_at', new.scheduled_at
            + greatest(0, segment_offset)::double precision * interval '1 minute',
          'end_at', new.scheduled_at
            + (
              greatest(0, segment_offset)::double precision
              + segment_duration::double precision
            ) * interval '1 minute'
        ));
      end if;
    end loop;
  end if;

  for ba in
    select membership_id, is_primary,
           split_start_offset_minutes, split_duration_minutes
    from public.booking_assignees
    where booking_id = new.id
  loop
    if ba.membership_id = any(split_ids) then
      continue;
    end if;

    -- When the lead changes before the junction table is synchronized, do not
    -- treat its old primary row as part of the proposed crew.
    if tg_op = 'UPDATE' then
      if old_assigned_to is distinct from new.assigned_to
        and ba.is_primary
        and ba.membership_id = old_assigned_to
      then
        continue;
      end if;
    end if;

    windows := windows || jsonb_build_array(jsonb_build_object(
      'membership_id', ba.membership_id,
      'start_at', new.scheduled_at
        + case when has_split and ba.split_start_offset_minutes is not null
            then greatest(0, ba.split_start_offset_minutes)::double precision
            else 0::double precision
          end * interval '1 minute',
      'end_at', new.scheduled_at
        + (
          case when has_split and ba.split_start_offset_minutes is not null
              then greatest(0, ba.split_start_offset_minutes)::double precision
              else 0::double precision
            end
          + case when has_split and ba.split_duration_minutes is not null
              then greatest(0, ba.split_duration_minutes)::double precision
              else new.duration_minutes::double precision
            end
        ) * interval '1 minute'
    ));
  end loop;

  if new.assigned_to is not null
    and not (new.assigned_to = any(split_ids))
    and not exists (
      select 1
      from public.booking_assignees ba
      where ba.booking_id = new.id
        and ba.membership_id = new.assigned_to
        and not (
          tg_op = 'UPDATE'
          and old_assigned_to is distinct from new.assigned_to
          and ba.is_primary
          and ba.membership_id = old_assigned_to
        )
    )
  then
    windows := windows || jsonb_build_array(jsonb_build_object(
      'membership_id', new.assigned_to,
      'start_at', new.scheduled_at,
      'end_at', new.scheduled_at
        + new.duration_minutes::double precision * interval '1 minute'
    ));
  end if;

  if public.booking_schedule_windows_conflict(
    new.organization_id,
    new.id,
    windows
  ) then
    raise exception 'A cleaner already has an overlapping booking'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function public.check_booking_schedule_write() from public;

drop trigger if exists booking_schedule_conflict_guard on public.bookings;
create trigger booking_schedule_conflict_guard
after insert or update of
  organization_id, scheduled_at, scheduled_local, scheduled_tz,
  duration_minutes, assigned_to, splits, status
on public.bookings
for each row execute function public.check_booking_schedule_write();

create or replace function public.check_booking_assignee_schedule_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  parent_booking record;
  parent_organization_id uuid;
  start_offset integer;
  segment_duration integer;
  windows jsonb;
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

  select organization_id
    into parent_organization_id
  from public.bookings
  where id = new.booking_id;

  if not found then
    return new;
  end if;

  perform public.lock_booking_schedule_writes(parent_organization_id);

  select id, organization_id, scheduled_at, duration_minutes, status
    into parent_booking
  from public.bookings
  where id = new.booking_id;

  if not found or parent_booking.status = 'cancelled' then
    return new;
  end if;

  start_offset := greatest(0, coalesce(new.split_start_offset_minutes, 0));
  segment_duration := greatest(
    0,
    coalesce(new.split_duration_minutes, parent_booking.duration_minutes)
  );
  if segment_duration = 0 then
    return new;
  end if;

  windows := jsonb_build_array(jsonb_build_object(
    'membership_id', new.membership_id,
    'start_at', parent_booking.scheduled_at
      + start_offset::double precision * interval '1 minute',
    'end_at', parent_booking.scheduled_at
      + (
        start_offset::double precision + segment_duration::double precision
      ) * interval '1 minute'
  ));

  if public.booking_schedule_windows_conflict(
    parent_booking.organization_id,
    parent_booking.id,
    windows
  ) then
    raise exception 'A cleaner already has an overlapping booking'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function public.check_booking_assignee_schedule_write() from public;

drop trigger if exists booking_assignee_schedule_conflict_guard
  on public.booking_assignees;
create trigger booking_assignee_schedule_conflict_guard
after insert or update of
  organization_id, booking_id, membership_id,
  split_start_offset_minutes, split_duration_minutes
on public.booking_assignees
for each row execute function public.check_booking_assignee_schedule_write();

comment on function public.lock_booking_schedule_writes(uuid) is
  'Transaction-scoped serialization lock for schedule writes within one organization.';
comment on function public.booking_schedule_windows_conflict(uuid, uuid, jsonb) is
  'Checks proposed windows against non-cancelled primary and crew assignments.';
