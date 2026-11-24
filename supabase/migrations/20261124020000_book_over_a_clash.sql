-- "Book anyway": an owner or admin may put a cleaner on a visit that
-- overlaps another job she is already on.
--
-- WHY
-- Svitlana, 2026-11-23: "I would still like to be able to book this cleaning
-- ... it's just going to be overlapping, and then I can just move it
-- locally." The overlap guard refused every such save, so the office could
-- not put the visit down at all until the other job had been moved first.
--
-- NOW
-- One more value of the transaction-local setting sollos.crew_clash, which
-- update_booking_assignments_v2 already reads ('skip', 20261119040000):
-- 'allow' lets the save through with the overlap in it. The question
-- (booking_conflict_pairs) does not change; only the refusal is waived.
--
-- What 'allow' does NOT waive: a cleaner on a visit after her last working
-- day (20261124010000). That is the guard answering for the visit itself,
-- not for another job, and the office asked for it to be a hard stop.
--
-- One entry point sets it:
--   update_booking_assignments_allow_clashes   (the app calls this only
--                                               after the owner or admin
--                                               has seen the clash and
--                                               pressed "Book anyway")
--
-- Run AFTER 20261124010000_last_working_day.sql and BEFORE the code push.
-- Idempotent. Changes no existing rows.

begin;

-- As in 20261124010000, with one addition: in 'allow' mode only a
-- last-working-day pair (other id = the visit itself) refuses.
create or replace function public.assert_no_new_schedule_conflicts(
  p_organization_id uuid,
  p_booking_ids uuid[],
  p_before_state jsonb,
  p_before_pairs jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  after_state jsonb := public.booking_schedule_snapshot(p_organization_id, p_booking_ids);
  allow_overlaps boolean := coalesce(current_setting('sollos.crew_clash', true), '') = 'allow';
  bad record;
begin
  select now_pair.pair_booking_id, now_pair.pair_membership_id, now_pair.pair_other_id
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
  )
  and (not allow_overlaps or now_pair.pair_other_id = now_pair.pair_booking_id)
  order by (now_pair.pair_other_id = now_pair.pair_booking_id) desc
  limit 1;

  if found then
    if bad.pair_other_id = bad.pair_booking_id then
      perform public.raise_member_finished(p_organization_id, bad.pair_membership_id);
    end if;
    raise exception 'A cleaner already has an overlapping booking' using errcode = '23P01';
  end if;
end;
$$;
revoke all on function public.assert_no_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.assert_no_new_schedule_conflicts(uuid, uuid[], jsonb, jsonb) to service_role;

-- A list of visits, overlaps allowed.
create or replace function public.update_booking_assignments_allow_clashes(
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
  perform set_config('sollos.crew_clash', 'allow', true);
  perform public.update_booking_assignments_v2(p_organization_id, p_booking_ids, p_booking_patch, p_assignees);
  perform set_config('sollos.crew_clash', '', true);
end;
$$;
revoke all on function public.update_booking_assignments_allow_clashes(uuid, uuid[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_booking_assignments_allow_clashes(uuid, uuid[], jsonb, jsonb)
  to service_role;

commit;

notify pgrst, 'reload schema';
