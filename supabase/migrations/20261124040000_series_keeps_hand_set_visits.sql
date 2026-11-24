-- A series save can leave alone the visits someone changed by hand.
--
-- WHY
-- "This and all future" wrote the series' crew, price and notes onto every
-- later visit, and a save that changed the day, time or frequency deleted
-- every later visit and wrote new ones. A visit dragged to another day, or
-- given its own cleaner for one week, went back in line with the series the
-- next time anyone saved it, with nothing said. That got worse the day the
-- office could keep a cleaner on a clashing visit and move it herself
-- (20261124020000, 20261124030000): each visit fixed by hand was only safe
-- until the next series save.
--
-- NOW
--   bookings.crew_set_by_hand_at
--     When a person set this one visit's crew (the booking form or Change
--     crew with "just this booking", or a drag onto another cleaner).
--     The twin of time_set_by_hand_at (20261030010000). Null on every row
--     today: nothing is treated as hand-set until someone sets it again.
--
--   update_booking_series_keeping_hand_set(..., p_keep)
--     The series save (update_booking_series_with_assignees_skip_clashes),
--     with a list of later visits to keep:
--       [{ id, keep_time, keep_crew, move_to }]
--     Those visits are taken out of the series for the length of the save,
--     so it neither rewrites nor deletes them, then put back. Each then
--     takes what the save changes that it does NOT keep:
--       keep_crew   its crew stays; the price, notes and the rest follow
--       keep_time   its day and time stay; the series' crew goes on it
--       move_to     (a rebuild, crew kept, time not) it moves to this
--                   instant: the new schedule's slot for it
--     One transaction: a failure anywhere leaves the series as it was.
--     Returned with operation = 'kept', beside the series' own rows.
--
-- The app decides which visits to keep and asks the person first when the
-- save would override them (src/lib/series-hand-set.ts). With an empty list
-- it calls the old function, exactly as before.
--
-- Run AFTER 20261124030000 and BEFORE the code push. Idempotent. Changes no
-- existing rows.

begin;

alter table public.bookings add column if not exists crew_set_by_hand_at timestamptz;
comment on column public.bookings.crew_set_by_hand_at is
  'When a person set this one visit''s crew by hand (not through a "this and all future" series save). A later series save asks before overriding it. Null when the crew is the series'' own.';

create or replace function public.update_booking_series_keeping_hand_set(
  p_organization_id uuid,
  p_series_id uuid,
  p_current_booking_id uuid,
  p_from timestamptz,
  p_current_booking_patch jsonb,
  p_current_assignees jsonb,
  p_sibling_booking_patch jsonb,
  p_series_patch jsonb,
  p_replace_schedule boolean,
  p_booking_rows jsonb,
  p_additional_assignee_ids uuid[],
  p_keep jsonb
)
returns table (
  operation text,
  id uuid,
  scheduled_at timestamptz,
  google_calendar_event_id text,
  status public.booking_status,
  added_assignee_ids uuid[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  keep_ids uuid[];
  series_rows jsonb;
  k record;
  fields jsonb;
  crew_rows jsonb;
  added uuid[];
begin
  if p_organization_id is null or p_series_id is null or p_current_booking_id is null or p_from is null
    or jsonb_typeof(p_keep) is distinct from 'array'
    or jsonb_typeof(p_sibling_booking_patch) is distinct from 'object'
    or jsonb_typeof(p_current_assignees) is distinct from 'array'
  then
    raise exception 'Invalid recurring booking update input' using errcode = '22023';
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);

  -- Only later visits of THIS series, still ahead and still open: the same
  -- visits the save would otherwise have touched.
  select coalesce(array_agg(b.id), '{}'::uuid[])
    into keep_ids
  from jsonb_to_recordset(p_keep) as x(id uuid)
  join public.bookings b on b.id = x.id
  where b.organization_id = p_organization_id
    and b.series_id = p_series_id
    and b.id <> p_current_booking_id
    and b.scheduled_at >= p_from
    and b.status in ('pending', 'confirmed');

  -- Out of the series while it is saved: not a sibling to rewrite, not a
  -- future occurrence to replace.
  update public.bookings b
  set series_id = null
  where b.id = any(keep_ids)
    and b.organization_id = p_organization_id;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into series_rows
  from public.update_booking_series_with_assignees_skip_clashes(
    p_organization_id, p_series_id, p_current_booking_id, p_from,
    p_current_booking_patch, p_current_assignees, p_sibling_booking_patch,
    p_series_patch, p_replace_schedule, p_booking_rows, p_additional_assignee_ids
  ) t;

  update public.bookings b
  set series_id = p_series_id
  where b.id = any(keep_ids)
    and b.organization_id = p_organization_id;

  -- Each kept visit takes what it does not keep. Clashes are skipped, as in
  -- the series save itself: someone with another job then comes off that
  -- visit and it is marked.
  perform set_config('sollos.crew_clash', 'skip', true);
  for k in
    select b.id, b.assigned_to,
           coalesce(x.keep_time, false) as keep_time,
           coalesce(x.keep_crew, false) as keep_crew,
           x.move_to
    from jsonb_to_recordset(p_keep) as x(id uuid, keep_time boolean, keep_crew boolean, move_to timestamptz)
    join public.bookings b on b.id = x.id
    where b.id = any(keep_ids)
    order by b.scheduled_at, b.id
  loop
    fields := p_sibling_booking_patch
      - 'assigned_to' - 'splits' - 'scheduled_at' - 'scheduled_local' - 'scheduled_tz';
    if not k.keep_time and k.move_to is not null then
      fields := fields || jsonb_build_object('scheduled_at', k.move_to);
    end if;

    if k.keep_crew then
      perform public.update_booking_assignments_v2(p_organization_id, array[k.id], fields, null);
      added := '{}'::uuid[];
    else
      select coalesce(array_agg(template.membership_id) filter (
               where prior.membership_id is null
                 and k.assigned_to is distinct from template.membership_id
             ), '{}'::uuid[]),
             coalesce(jsonb_agg(jsonb_build_object(
               'booking_id', k.id,
               'membership_id', template.membership_id,
               'is_primary', template.is_primary,
               'split_index', template.split_index,
               'split_start_offset_minutes', template.split_start_offset_minutes,
               'split_duration_minutes', template.split_duration_minutes,
               'acceptance_status', coalesce(prior.acceptance_status, 'pending'),
               'responded_at', prior.responded_at,
               'completed_at', prior.completed_at
             )), '[]'::jsonb)
        into added, crew_rows
      from jsonb_to_recordset(p_current_assignees) as template(
        membership_id uuid,
        is_primary boolean,
        split_index integer,
        split_start_offset_minutes integer,
        split_duration_minutes integer
      )
      left join public.booking_assignees prior
        on prior.booking_id = k.id
       and prior.membership_id = template.membership_id;

      if p_sibling_booking_patch ? 'assigned_to' then
        fields := fields || jsonb_build_object('assigned_to', p_sibling_booking_patch -> 'assigned_to');
      end if;
      if p_sibling_booking_patch ? 'splits' then
        fields := fields || jsonb_build_object('splits', p_sibling_booking_patch -> 'splits');
      end if;
      perform public.update_booking_assignments_v2(p_organization_id, array[k.id], fields, crew_rows);

      -- Someone taken off for a clash was not added, so is not told.
      added := coalesce(array(
        select a.member_id
        from unnest(added) as a(member_id)
        where exists (
          select 1 from public.booking_assignees ba
          where ba.booking_id = k.id and ba.membership_id = a.member_id
        )
      ), '{}'::uuid[]);
    end if;

    return query
    select 'kept'::text, b.id, b.scheduled_at, b.google_calendar_event_id, b.status, added
    from public.bookings b
    where b.id = k.id;
  end loop;
  perform set_config('sollos.crew_clash', '', true);

  return query
  select
    e.value ->> 'operation',
    (e.value ->> 'id')::uuid,
    (e.value ->> 'scheduled_at')::timestamptz,
    e.value ->> 'google_calendar_event_id',
    (e.value ->> 'status')::public.booking_status,
    coalesce(array(
      select jsonb_array_elements_text(
        case when jsonb_typeof(e.value -> 'added_assignee_ids') = 'array'
          then e.value -> 'added_assignee_ids' else '[]'::jsonb end
      )::uuid
    ), '{}'::uuid[])
  from jsonb_array_elements(series_rows) as e(value);
end;
$$;
revoke all on function public.update_booking_series_keeping_hand_set(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[], jsonb
) from public, anon, authenticated;
grant execute on function public.update_booking_series_keeping_hand_set(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[], jsonb
) to service_role;

commit;

notify pgrst, 'reload schema';
