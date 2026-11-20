-- A recurring series' crew: put them on every visit they are free for.
--
-- WHY
-- Putting a crew on a series checked every visit in it, and one clash
-- anywhere refused all of it. A cleaner free this Friday and booked on three
-- Fridays months out could not be put on the series at all; the office saved
-- it with nobody on it and filled every visit by hand (Svitlana, 2026-11-14;
-- asked for again in person, 2026-11-19).
--
-- NOW
-- A series save can ask for clashes to be skipped instead of refused. The
-- crew goes on every visit. Where someone has another job at that time, that
-- one person comes off that one visit, everyone else stays, and the visit is
-- marked as needing cover:
--   bookings.cover_needed = [{ membership_id, other_booking_id }, ...]
-- The mark is cleared the next time that visit's crew is saved.
--
-- What "a clash" is does not change: it is the guard's own question
-- (booking_conflict_pairs, and the "new, and hers to answer for" test in
-- assert_no_new_schedule_conflicts). A one-off booking is still refused.
--
-- HOW
-- update_booking_assignments_v2 already wraps every crew save: write with
-- the guard deferred, then ask once. It now reads one transaction-local
-- setting, sollos.crew_clash. When it is 'skip', it takes the clashing
-- people off before asking. Two thin entry points set it:
--   update_booking_assignments_skip_clashes            (a list of visits)
--   update_booking_series_with_assignees_skip_clashes  ("this and future")
--
-- Run BEFORE the code push: the app calls the two new functions and reads
-- the new column. Idempotent. Changes no existing rows.

begin;

alter table public.bookings add column if not exists cover_needed jsonb;
comment on column public.bookings.cover_needed is
  'People a series save meant for this visit but left off because they had another job then: [{membership_id, other_booking_id}]. Null when nobody was. Cleared when the visit''s crew is next saved.';

-- Take off, visit by visit, anyone with a clash that this save created.
-- Repeats, because taking one person off a shared visit makes the others'
-- share longer, which can clash in turn. Bounded: each pass removes someone.
create or replace function public.drop_new_schedule_conflicts(
  p_organization_id uuid,
  p_booking_ids uuid[],
  p_before_state jsonb,
  p_before_pairs jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  after_state jsonb;
  bad jsonb;
  removed jsonb := '[]'::jsonb;
  pass integer := 0;
  r record;
  keep jsonb;
  new_lead uuid;
begin
  loop
    pass := pass + 1;
    exit when pass > 25;
    after_state := public.booking_schedule_snapshot(p_organization_id, p_booking_ids);

    -- The same test assert_no_new_schedule_conflicts makes.
    select jsonb_agg(distinct jsonb_build_object('b', now_pair.pair_booking_id, 'm', now_pair.pair_membership_id, 'o', now_pair.pair_other_id))
      into bad
    from public.booking_conflict_pairs(p_organization_id, p_booking_ids) now_pair
    where not exists (
      select 1
      from jsonb_to_recordset(p_before_pairs) as was(b uuid, m uuid, o uuid)
      where was.b = now_pair.pair_booking_id
        and was.m = now_pair.pair_membership_id
        and was.o = now_pair.pair_other_id
    )
    and not (
      (p_before_state -> now_pair.pair_booking_id::text -> 'sched')
        is not distinct from (after_state -> now_pair.pair_booking_id::text -> 'sched')
      and (p_before_state -> now_pair.pair_booking_id::text -> 'crew') ? now_pair.pair_membership_id::text
      and (p_before_state -> now_pair.pair_booking_id::text -> 'crew' -> now_pair.pair_membership_id::text)
        is not distinct from (after_state -> now_pair.pair_booking_id::text -> 'crew' -> now_pair.pair_membership_id::text)
    );
    exit when bad is null;

    for r in
      select x.b as booking_id, array_agg(distinct x.m) as members
      from jsonb_to_recordset(bad) as x(b uuid, m uuid, o uuid)
      group by x.b
    loop
      -- Who leads the visit once they are off: the lead if she stays,
      -- otherwise the first person left.
      select ba.membership_id into new_lead
      from public.booking_assignees ba
      where ba.booking_id = r.booking_id
        and not (ba.membership_id = any(r.members))
      order by ba.is_primary desc, ba.split_index nulls last, ba.membership_id
      limit 1;

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
        into keep
      from public.booking_assignees ba
      where ba.booking_id = r.booking_id
        and not (ba.membership_id = any(r.members));

      -- The ordinary writer, so a visit with someone taken off is shaped
      -- exactly like one saved that way by hand.
      perform public.update_booking_assignments_v2_apply(
        p_organization_id,
        array[r.booking_id],
        jsonb_build_object('assigned_to', new_lead),
        keep
      );
    end loop;

    removed := removed || bad;
  end loop;

  update public.bookings b
  set cover_needed = (
    select jsonb_agg(distinct jsonb_build_object('membership_id', x.m, 'other_booking_id', x.o))
    from jsonb_to_recordset(removed) as x(b uuid, m uuid, o uuid)
    where x.b = b.id
  )
  where b.organization_id = p_organization_id
    and b.id in (select x.b from jsonb_to_recordset(removed) as x(b uuid, m uuid, o uuid));
end;
$$;
revoke all on function public.drop_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- The wrapper, as in 20261115010000, with two additions: a crew save clears
-- the "needs cover" mark, and in 'skip' mode clashing people come off before
-- the question is asked.
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
declare
  before_state jsonb;
  before_pairs jsonb;
  already_deferred boolean := public.booking_schedule_check_deferred();
  skip_clashes boolean := coalesce(current_setting('sollos.crew_clash', true), '') = 'skip';
begin
  -- Bad input: let the writer say so in its own words.
  if p_organization_id is null or p_booking_ids is null then
    perform public.update_booking_assignments_v2_apply(p_organization_id, p_booking_ids, p_booking_patch, p_assignees);
    return;
  end if;

  perform public.lock_booking_schedule_writes(p_organization_id);
  before_state := public.booking_schedule_snapshot(p_organization_id, p_booking_ids);
  select coalesce(jsonb_agg(jsonb_build_object('b', p.pair_booking_id, 'm', p.pair_membership_id, 'o', p.pair_other_id)), '[]'::jsonb)
    into before_pairs
  from public.booking_conflict_pairs(p_organization_id, p_booking_ids) p;

  perform set_config('sollos.schedule_check', 'batch', true);
  perform public.update_booking_assignments_v2_apply(p_organization_id, p_booking_ids, p_booking_patch, p_assignees);

  -- The crew was just set on these visits, so whatever cover they needed
  -- has been answered. Skip mode marks afresh below.
  if p_assignees is not null then
    update public.bookings b
    set cover_needed = null
    where b.organization_id = p_organization_id
      and b.id = any(p_booking_ids)
      and b.cover_needed is not null;
  end if;

  if skip_clashes then
    perform public.drop_new_schedule_conflicts(p_organization_id, p_booking_ids, before_state, before_pairs);
  end if;

  if not already_deferred then
    perform set_config('sollos.schedule_check', '', true);
  end if;

  perform public.assert_no_new_schedule_conflicts(p_organization_id, p_booking_ids, before_state, before_pairs);
end;
$$;
revoke all on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_booking_assignments_v2(uuid, uuid[], jsonb, jsonb)
  to service_role;

-- A list of visits, clashes skipped.
create or replace function public.update_booking_assignments_skip_clashes(
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
  perform set_config('sollos.crew_clash', 'skip', true);
  perform public.update_booking_assignments_v2(p_organization_id, p_booking_ids, p_booking_patch, p_assignees);
  perform set_config('sollos.crew_clash', '', true);
end;
$$;
revoke all on function public.update_booking_assignments_skip_clashes(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_booking_assignments_skip_clashes(uuid, uuid[], jsonb, jsonb)
  to service_role;

-- "This and all future visits", clashes skipped.
create or replace function public.update_booking_series_with_assignees_skip_clashes(
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
  status public.booking_status,
  added_assignee_ids uuid[]
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('sollos.crew_clash', 'skip', true);
  -- added_assignee_ids is who the save meant to add, and the app tells each
  -- of them about the visit. Someone taken off a visit for a clash was not
  -- added to it, so she is not told about it.
  return query
  select t.operation, t.id, t.scheduled_at, t.google_calendar_event_id, t.status,
    coalesce(array(
      select added.member_id
      from unnest(t.added_assignee_ids) as added(member_id)
      where exists (
        select 1 from public.booking_assignees ba
        where ba.booking_id = t.id and ba.membership_id = added.member_id
      )
    ), '{}'::uuid[])
  from public.update_booking_series_with_assignees(
    p_organization_id, p_series_id, p_current_booking_id, p_from,
    p_current_booking_patch, p_current_assignees, p_sibling_booking_patch,
    p_series_patch, p_replace_schedule, p_booking_rows, p_additional_assignee_ids
  ) t;
  perform set_config('sollos.crew_clash', '', true);
end;
$$;
revoke all on function public.update_booking_series_with_assignees_skip_clashes(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[]
) from public, anon, authenticated;
grant execute on function public.update_booking_series_with_assignees_skip_clashes(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, uuid[]
) to service_role;

commit;

-- PostgREST caches the schema; without this the new functions and column
-- are invisible to the API until the cache happens to refresh.
notify pgrst, 'reload schema';
