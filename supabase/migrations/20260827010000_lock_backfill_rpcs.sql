-- Lock the checklist backfill functions to service_role.
--
-- Both are SECURITY DEFINER and were executable by any authenticated user
-- (PostgreSQL grants EXECUTE to PUBLIC by default), so any logged-in user
-- who somehow learned a foreign org's template uuid could invoke a backfill
-- against that org. Template ids aren't readable cross-org (RLS), so this
-- was never practically exploitable — but every other tenant seam in this
-- app is enforced at the database, and this one now matches.
--
-- The app calls both through the service-role client as of the same-day
-- deploy; run this AFTER that deploy is live, or template save/assign
-- backfills fail for the minute in between.

revoke execute on function public.backfill_client_checklist(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.backfill_client_checklist(uuid, uuid)
  to service_role;

revoke execute on function public.backfill_service_checklist(uuid)
  from public, anon, authenticated;
grant execute on function public.backfill_service_checklist(uuid)
  to service_role;

notify pgrst, 'reload schema';
