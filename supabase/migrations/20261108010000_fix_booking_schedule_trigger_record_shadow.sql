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
  assignment_row record;
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

  for assignment_row in
    select membership_id, is_primary,
           split_start_offset_minutes, split_duration_minutes
    from public.booking_assignees
    where booking_id = new.id
  loop
    if assignment_row.membership_id = any(split_ids) then
      continue;
    end if;

    -- When the lead changes before the junction table is synchronized, do not
    -- treat its old primary row as part of the proposed crew.
    if tg_op = 'UPDATE' then
      if old_assigned_to is distinct from new.assigned_to
        and assignment_row.is_primary
        and assignment_row.membership_id = old_assigned_to
      then
        continue;
      end if;
    end if;

    windows := windows || jsonb_build_array(jsonb_build_object(
      'membership_id', assignment_row.membership_id,
      'start_at', new.scheduled_at
        + case when has_split and assignment_row.split_start_offset_minutes is not null
            then greatest(0, assignment_row.split_start_offset_minutes)::double precision
            else 0::double precision
          end * interval '1 minute',
      'end_at', new.scheduled_at
        + (
          case when has_split and assignment_row.split_start_offset_minutes is not null
              then greatest(0, assignment_row.split_start_offset_minutes)::double precision
              else 0::double precision
            end
          + case when has_split and assignment_row.split_duration_minutes is not null
              then greatest(0, assignment_row.split_duration_minutes)::double precision
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
