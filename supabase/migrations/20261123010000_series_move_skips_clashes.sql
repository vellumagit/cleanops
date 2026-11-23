-- Moving a recurring series to another day or time: put the crew on every
-- visit they are free for.
--
-- WHY
-- 20261119040000 made a series' crew save skip a clash instead of refusing:
-- the person comes off that one visit and it is marked "Needs cover". That
-- covered a new series and a "this and all future" save that keeps the
-- series' days. A save that also MOVES the series (a visit put on another
-- day, a new time, a new frequency) rebuilds the later visits through
-- replace_future_series_bookings, and that was left refusing on any clash.
--
-- Svit, 2026-11-23: Nella and Joe Cotesta, every three weeks, moved from
-- Wednesday to Thursday with Olha on it. Olha has Bonnie Sherwood Park every
-- second Thursday, so one visit in two clashed, and the whole save was
-- refused: "already booked on 5 of these dates. Nothing was changed."
--
-- NOW
-- The rebuild follows the same rule when the save asks for it
-- (sollos.crew_clash = 'skip', set by
-- update_booking_series_with_assignees_skip_clashes). The new visits are
-- written with the guard standing aside, anyone with another job at that
-- time comes off that one visit and it is marked, and then the guard's
-- question is asked about what is left. Without the setting the function
-- behaves exactly as before.
--
-- A visit whose crew is on split times keeps refusing: the person's segment
-- is written on the visit itself, so taking her off the crew would leave it.
--
-- Run BEFORE the code push. Safe to run more than once. Changes no rows.

begin;

-- The body that does the writing keeps its code and moves to a new name; the
-- old name becomes the wrapper around it.
do $$
begin
  if to_regprocedure('public.replace_future_series_bookings_apply(uuid, uuid, uuid, timestamptz, jsonb, uuid[])') is null then
    alter function public.replace_future_series_bookings(uuid, uuid, uuid, timestamptz, jsonb, uuid[])
      rename to replace_future_series_bookings_apply;
  end if;
end;
$$;
revoke all on function public.replace_future_series_bookings_apply(
  uuid, uuid, uuid, timestamptz, jsonb, uuid[]
) from public, anon, authenticated, service_role;

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
#variable_conflict use_column
declare
  skip_clashes boolean := coalesce(current_setting('sollos.crew_clash', true), '') = 'skip';
  already_deferred boolean := public.booking_schedule_check_deferred();
  result_rows jsonb;
  new_ids uuid[];
begin
  if not skip_clashes then
    return query
    select r.operation, r.id, r.scheduled_at, r.google_calendar_event_id
    from public.replace_future_series_bookings_apply(
      p_organization_id, p_series_id, p_current_booking_id, p_from,
      p_booking_rows, p_additional_assignee_ids
    ) r;
    return;
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);
  perform set_config('sollos.schedule_check', 'batch', true);

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    into result_rows
  from public.replace_future_series_bookings_apply(
    p_organization_id, p_series_id, p_current_booking_id, p_from,
    p_booking_rows, p_additional_assignee_ids
  ) r;

  select coalesce(array_agg(x.id), '{}'::uuid[])
    into new_ids
  from jsonb_to_recordset(result_rows) as x(operation text, id uuid)
  where x.operation = 'inserted';

  -- These visits did not exist before this save, so every clash on them is
  -- one this save made: nothing to compare against.
  if cardinality(new_ids) > 0 then
    perform public.drop_new_schedule_conflicts(p_organization_id, new_ids, '{}'::jsonb, '[]'::jsonb);
  end if;

  if not already_deferred then
    perform set_config('sollos.schedule_check', '', true);
  end if;

  if cardinality(new_ids) > 0 then
    perform public.assert_no_new_schedule_conflicts(p_organization_id, new_ids, '{}'::jsonb, '[]'::jsonb);
  end if;

  return query
  select x.operation, x.id, x.scheduled_at, x.google_calendar_event_id
  from jsonb_to_recordset(result_rows) as x(
    operation text,
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
  'Atomically replaces pending and confirmed future occurrences, including crew. With sollos.crew_clash = skip, someone with another job at a new visit''s time is left off that visit and it is marked cover_needed; otherwise a clash refuses the whole replacement.';

commit;

notify pgrst, 'reload schema';
