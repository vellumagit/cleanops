-- 'billing' — money notices to owners: "Refund issued" and "Payment on a
-- voided invoice" (Stripe and Square). The code has sent this type since
-- Aug 20 without it ever being a member of the enum, so every one of those
-- inserts failed 22P02. Inside the payment webhooks the failed insert also
-- stopped the push and email, so owners heard nothing about refunds or
-- money paid on a void invoice. Found by the money-flow race tests,
-- 2026-11-16. src/lib/notification-types.ts now lists the enum, and notify()
-- accepts nothing else.
--
-- Guarded the same way as the other additions (20260801010000,
-- 20260923020000): `add value` is not idempotent on its own and re-running a
-- migration must not fail.

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_type' and e.enumlabel = 'billing'
  ) then
    alter type public.notification_type add value 'billing';
  end if;
end $$;

notify pgrst, 'reload schema';
