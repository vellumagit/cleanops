-- =============================================================================
-- Internal functions stop being callable with the public key
-- =============================================================================
-- "revoke all on function ... from public" does not close a function on
-- Supabase. The platform's default privileges grant EXECUTE to the anon and
-- authenticated roles BY NAME on every function created in public, and
-- revoking from PUBLIC leaves those two grants standing. Seven migrations
-- wrote the PUBLIC-only revoke on SECURITY DEFINER functions, so each stayed
-- callable through /rest/v1/rpc with the key that ships in every browser.
--
-- Verified 2026-11-10: the anon key ran booking_shares_hours in production.
-- Found by test/db/schema.test.ts, which now pins who may call what.
--
-- What an outside caller could do with them:
--   bump_org_email_counter      write: run up any org's daily email count
--                               until its outbound cap refuses real mail
--   ensure_general_thread       write: create a chat thread in any org
--   booking_member_windows,
--   booking_schedule_conflicts,
--   booking_schedule_windows_conflict
--                               read: who is scheduled when, in any org
--   booking_shares_hours        read: one org setting
--   lock_booking_schedule_writes  take an org's schedule lock
--
-- Every caller of these is another SECURITY DEFINER function (which runs as
-- the owner and needs no grant) or the service role (email.ts bumps the
-- counter through the admin client). Nothing signed-in or anonymous calls
-- them, so nothing changes for the app.
--
-- Safe to run before or after the push. Idempotent.
-- =============================================================================

revoke all on function public.bump_org_email_counter(uuid, date)
  from public, anon, authenticated;
revoke all on function public.ensure_general_thread(uuid)
  from public, anon, authenticated;
revoke all on function public.booking_shares_hours(boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.lock_booking_schedule_writes(uuid)
  from public, anon, authenticated;
revoke all on function public.booking_schedule_conflicts(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.booking_schedule_windows_conflict(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.booking_member_windows(
  uuid, uuid, timestamptz, integer, jsonb, uuid, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.bump_org_email_counter(uuid, date) to service_role;
grant execute on function public.ensure_general_thread(uuid) to service_role;
grant execute on function public.booking_shares_hours(boolean, uuid) to service_role;
grant execute on function public.lock_booking_schedule_writes(uuid) to service_role;
grant execute on function public.booking_schedule_conflicts(uuid, uuid, jsonb) to service_role;
grant execute on function public.booking_schedule_windows_conflict(uuid, uuid, jsonb) to service_role;
grant execute on function public.booking_member_windows(
  uuid, uuid, timestamptz, integer, jsonb, uuid, boolean, uuid
) to service_role;

-- booking_schedule_has_conflict is the door a signed-in owner or admin is
-- meant to use: it checks the caller's role, then asks
-- booking_schedule_windows_conflict. As an invoker-rights function it needed
-- the caller to hold EXECUTE on that inner function too, which is exactly
-- what let anyone skip the role check by calling the inner one directly.
-- Running as the owner makes the wrapper the only way in. Its role check
-- reads auth.uid(), which is the caller's either way.
alter function public.booking_schedule_has_conflict(uuid, uuid, jsonb)
  security definer;
revoke all on function public.booking_schedule_has_conflict(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.booking_schedule_has_conflict(uuid, uuid, jsonb)
  to authenticated, service_role;

-- The chat counters answer only about the caller, so a call without a
-- session returns nothing. There is still no reason for it to be possible.
revoke all on function public.chat_mark_thread_read(uuid) from public, anon;
revoke all on function public.chat_unread_threads(uuid) from public, anon;
revoke all on function public.chat_unread_total(uuid) from public, anon;
grant execute on function public.chat_mark_thread_read(uuid) to authenticated, service_role;
grant execute on function public.chat_unread_threads(uuid) to authenticated, service_role;
grant execute on function public.chat_unread_total(uuid) to authenticated, service_role;

-- Left as they are, on purpose: current_user_org_ids, current_user_has_role,
-- current_user_membership_ids, current_user_thread_ids, is_booking_crew.
-- RLS policies call them as the querying role, two of those policies apply to
-- every role, and each answers only about auth.uid().
