-- =============================================================================
-- A firing gets a date and a reason, not just a status
-- supabase/migrations/20260902050000_membership_exit.sql
-- =============================================================================
-- status = 'disabled' says THAT someone left; nothing said WHEN or WHY. The
-- Archived tab knew they were gone, the audit log buried the date, and the
-- reason lived in nobody's memory. Two columns:
--
--   deactivated_at  on memberships — stamped by the deactivation action,
--     cleared on every rehire path (status flip and invite re-claim). Lives
--     on memberships because it's no more sensitive than the status column
--     the whole team can already read.
--
--   exit_reason  on membership_admin_data — because WHY someone was let go
--     is HR material, and membership_admin_data already carries the
--     owner/admin-only RLS that notes and accommodations rely on. The
--     org-wide memberships SELECT policy must never expose it.
--
-- Existing disabled rows keep NULL dates — the UI says "Deactivated" without
-- a date rather than inventing one.

alter table public.memberships
  add column if not exists deactivated_at timestamptz;

comment on column public.memberships.deactivated_at is
  'When this member was last deactivated (status -> disabled). Cleared on every rehire path. NULL on active members and on members disabled before this column existed.';

alter table public.membership_admin_data
  add column if not exists exit_reason text
    check (exit_reason is null or char_length(exit_reason) <= 500);

comment on column public.membership_admin_data.exit_reason is
  'Why the member was deactivated, entered at deactivation time. Owner/admin-only via this table''s RLS. Each deactivation overwrites it — absent reason clears it, so a rehire-then-refire never resurrects a stale reason.';

notify pgrst, 'reload schema';
