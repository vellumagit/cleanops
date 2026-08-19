-- =============================================================================
-- Someone has to be allowed to write down a cash tip
-- supabase/migrations/20260819030000_invoice_tips_insert_policy.sql
-- =============================================================================
-- invoice_tips shipped with SELECT and UPDATE policies and no INSERT policy at
-- all, and the comment in 20260819020000 explained why: every write came from
-- the Stripe webhook via the service role, which bypasses RLS, so "a tip nobody
-- paid should not be creatable from a browser."
--
-- That was true for about two hours. Manual tipping then added exactly the
-- browser write path that reasoning excluded — an owner recording a $20 tip
-- that arrived with an e-transfer — using the RLS-bound client like every other
-- action. RLS did precisely what it was told and refused:
--
--   42501  new row violates row-level security policy for table "invoice_tips"
--
-- So the feature was dead on arrival for the payment method 21 of this client's
-- 23 payments use. Verified by attempting the insert as a non-service role.
--
-- Owner/admin only, matching the SELECT and UPDATE policies above it and the
-- action that calls it (recordInvoicePaymentAction is already owner/admin —
-- money in and money out is not a manager capability). Managers keep no write
-- here even though they can write clients and bookings; that asymmetry is
-- deliberate and predates this.
--
-- Deliberately NOT solved by switching the caller to the service role. That
-- would work, and it would quietly delete the boundary rather than correct it.

drop policy if exists invoice_tips_insert on public.invoice_tips;
create policy invoice_tips_insert on public.invoice_tips
  for insert to authenticated
  with check (exists (
    select 1 from public.memberships m
    where m.organization_id = invoice_tips.organization_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','admin')
      and m.status = 'active'
  ));

notify pgrst, 'reload schema';
