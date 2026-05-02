-- =============================================================================
-- Archive immutability
-- =============================================================================
-- Tighten UPDATE policies on bookings, invoices, and estimates so that
-- authenticated users cannot modify rows that have already been archived
-- (archived_at IS NOT NULL).
--
-- The nightly archive cron uses the service-role client and bypasses RLS,
-- so it can still set archived_at and perform any other necessary mutations.
-- Admin writes made through the admin client in server actions are similarly
-- unaffected.
--
-- Idempotent — safe to re-run.

-- ── bookings ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admins or assignee update bookings" ON public.bookings;
CREATE POLICY "admins or assignee update bookings"
ON public.bookings FOR UPDATE
TO authenticated
USING (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  OR (
    assigned_to IN (
      SELECT id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
  )
)
WITH CHECK (
  -- Block updates to archived rows via the authenticated client.
  archived_at IS NULL
  AND (
    public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
    OR (
      assigned_to IN (
        SELECT id FROM public.memberships
        WHERE profile_id = auth.uid() AND status = 'active'
      )
    )
  )
);

-- ── estimates ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admins update estimates" ON public.estimates;
CREATE POLICY "admins update estimates"
ON public.estimates FOR UPDATE
TO authenticated
USING (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
)
WITH CHECK (
  archived_at IS NULL
  AND public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- ── invoices ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admins update invoices" ON public.invoices;
CREATE POLICY "admins update invoices"
ON public.invoices FOR UPDATE
TO authenticated
USING (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
)
WITH CHECK (
  archived_at IS NULL
  AND public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);
