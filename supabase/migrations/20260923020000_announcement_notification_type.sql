-- 'announcement' — the Announce composer writes one org-wide notification per
-- announcement, and it should be filterable apart from routine 'general'
-- traffic.
--
-- Guarded the same way as the other additions (20260801010000,
-- 20260906010000): `add value` is not idempotent on its own and re-running a
-- migration must not fail.

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_type' and e.enumlabel = 'announcement'
  ) then
    alter type public.notification_type add value 'announcement';
  end if;
end $$;

notify pgrst, 'reload schema';
