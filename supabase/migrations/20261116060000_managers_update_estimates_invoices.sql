-- Managers get back the right to change estimates and invoices.
--
-- WHY
-- 20260411030001_manager_rls let owners, admins AND managers insert, update
-- and delete estimates and invoices. 20260502010000_archive_immutability
-- recreated the two UPDATE policies to add "archived rows can't change", but
-- copied the older owner/admin text and dropped managers without saying so.
-- 20261007020000_crew_update_bookings found the same accident on bookings and
-- put managers back; estimates and invoices were missed.
--
-- Since May a manager could still create, send and delete an estimate or an
-- invoice, but not change one:
--   * updateEstimateAction writes through her own session. The update matched
--     zero rows, Postgres reported success, and the form redirected as if it
--     had saved. Nothing had.
--   * updateInvoiceAction reconciles the line items first, then updates the
--     invoice. The items were rewritten; the invoice update matched nothing,
--     and she was told the invoice "could not be found" while its lines no
--     longer matched its total.
-- Both actions admit owner/admin/manager with the invoicing capability; this
-- makes the database agree with them again.
--
-- UNCHANGED
-- Archived rows stay immutable to signed-in users (archived_at is null in
-- WITH CHECK). Recording, refunding and deleting payments stay owner/admin:
-- those actions check the role themselves, and invoice_payments has its own
-- policies, which this migration does not touch.
--
-- Idempotent: safe to re-run.

drop policy if exists "admins update estimates" on public.estimates;
create policy "admins update estimates"
on public.estimates for update
to authenticated
using (
  public.current_user_has_role(
    organization_id,
    array['owner','admin','manager']::public.membership_role[]
  )
)
with check (
  archived_at is null
  and public.current_user_has_role(
    organization_id,
    array['owner','admin','manager']::public.membership_role[]
  )
);

drop policy if exists "admins update invoices" on public.invoices;
create policy "admins update invoices"
on public.invoices for update
to authenticated
using (
  public.current_user_has_role(
    organization_id,
    array['owner','admin','manager']::public.membership_role[]
  )
)
with check (
  archived_at is null
  and public.current_user_has_role(
    organization_id,
    array['owner','admin','manager']::public.membership_role[]
  )
);
