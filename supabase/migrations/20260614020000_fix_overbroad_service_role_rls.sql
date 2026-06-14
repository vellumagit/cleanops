-- Fix two cross-tenant RLS holes.
--
-- Both tables had a "service role manages ..." policy declared
--   FOR ALL USING (true) WITH CHECK (true)
-- with NO `TO` clause. RLS policies default to applying to ALL roles
-- (including `authenticated` and `anon`), and permissive policies are
-- OR-combined — so this `USING(true)` blew past the restrictive
-- "members read own ..." SELECT policy and let ANY signed-in user read,
-- update, and delete EVERY org's rows via the anon-key client.
--
-- ai_conversations.messages holds users' free-text questions about their
-- business — a real cross-tenant data leak. booking_member_calendar_events
-- is cross-tenant write/delete + an enumeration oracle.
--
-- All writes already go through the service-role admin client (which
-- bypasses RLS regardless), so scoping these policies to `service_role`
-- changes nothing for the app and closes the hole. Authenticated users
-- keep only their restrictive "members read own" SELECT policy.

drop policy if exists "service role manages ai conversations"
  on public.ai_conversations;
create policy "service role manages ai conversations"
  on public.ai_conversations for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manages booking_member_calendar_events"
  on public.booking_member_calendar_events;
create policy "service role manages booking_member_calendar_events"
  on public.booking_member_calendar_events for all
  to service_role
  using (true)
  with check (true);
