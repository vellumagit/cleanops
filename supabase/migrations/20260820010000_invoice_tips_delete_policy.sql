-- =============================================================================
-- The tip cleanup was deleting nothing, silently
-- supabase/migrations/20260820010000_invoice_tips_delete_policy.sql
-- =============================================================================
-- Yesterday's fix for the double-counted tip ("$20 given, $40 owed") deletes a
-- payment's unpaid tip rows when the payment itself is deleted. It runs on the
-- RLS-bound client, and invoice_tips has SELECT, UPDATE and INSERT policies —
-- but no DELETE policy. Postgres treats that not as an error but as "no rows
-- match": the delete succeeds and removes nothing. So the cleanup shipped,
-- tested green, and quietly did nothing in production; deleting a mistyped
-- payment still left its tip behind to be paid twice.
--
-- Found by re-reading the table's policies after ADDING the insert policy the
-- day before — same lesson, next verse: a new kind of write needs its policy
-- checked, and DELETE is a kind of write.
--
-- Owner/admin, matching insert and update: the only caller is the
-- delete-payment action, which is already owner/admin. The webhook's clawback
-- deletes run on the service role and never needed a policy.

drop policy if exists invoice_tips_delete on public.invoice_tips;
create policy invoice_tips_delete on public.invoice_tips
  for delete to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = invoice_tips.organization_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','admin')
      and m.status = 'active'
  ));

notify pgrst, 'reload schema';
