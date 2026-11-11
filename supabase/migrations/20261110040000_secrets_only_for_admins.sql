-- =============================================================================
-- Two tables every member could read that only an admin should
-- =============================================================================
-- From the September security audit's "Batch B" (2026-09-03), confirmed still
-- open on 2026-11-10 by test/db/rls.test.ts against the real policies.
--
-- 1. webhooks. "org_members_read_webhooks" let any active member of the
--    company SELECT its webhook rows, and a row carries `secret`, the key the
--    company's endpoint uses to trust what Sollos sends. A cleaner with the
--    browser console could read it and forge events to whatever the owner
--    connected. Only Settings -> Webhooks reads this table as a user, and it
--    is owner/admin only; delivery uses the service role. The owner/admin
--    "manage" policy already covers their reads, so the member policy simply
--    goes.
--
-- 2. integration_events. The read policy was
--      organization_id IS NULL OR <owner/admin of that org>
--    so an event that arrived with no company attached (an unmatched Square
--    webhook, stored with its full payload) was readable by every signed-in
--    user of every company. Nothing in the app reads these rows as a user.
--    Rows with no company are now for the service role only.
--
-- Production on 2026-11-10: no webhooks are configured anywhere, and no
-- integration event has a null company, so nothing was exposed. Safe to run
-- before or after the push. Re-runnable.
-- =============================================================================

drop policy if exists org_members_read_webhooks on public.webhooks;

drop policy if exists "admins read integration_events" on public.integration_events;
create policy "admins read integration_events"
  on public.integration_events
  for select
  to authenticated
  using (
    organization_id is not null
    and public.current_user_has_role(
      organization_id,
      array['owner', 'admin']::public.membership_role[]
    )
  );
