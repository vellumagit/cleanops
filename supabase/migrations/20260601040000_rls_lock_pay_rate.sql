-- Lock `memberships.pay_rate_cents` at the column level.
--
-- Today the SELECT policy "members can read memberships in their org"
-- (20260407044907_init_auth_orgs.sql:301) has no column filter. Any
-- employee with their JWT can run:
--
--   supabase.from("memberships").select("id, pay_rate_cents")
--
-- ...and dump every coworker's compensation. The UI gates Settings →
-- Members behind owner/admin role, but RLS is the only thing in the
-- way of a direct supabase-js call.
--
-- This migration uses Postgres column-level GRANT/REVOKE to lock the
-- pay_rate_cents column from `authenticated` (the role every
-- end-user JWT operates as). After this:
--   - End-user JWTs can still SELECT every OTHER column on memberships
--     in their org (so coworker name lookups, role checks, etc. keep
--     working without any code change).
--   - SELECTing pay_rate_cents specifically returns a "permission
--     denied for column" error.
--   - The service_role (used by createSupabaseAdminClient and Vercel
--     cron jobs) bypasses column grants and continues to see the
--     column.
--
-- Admin-side reads that need pay_rate_cents (payroll, timesheets,
-- employees CRUD, settings/members) are updated in the same PR to
-- use the admin client. The field-side clock-in rate snapshot is
-- also updated.
--
-- INSERT and UPDATE are NOT affected — column grants for those
-- continue to work. New employees can have pay_rate_cents set by
-- admin actions (which use admin client anyway).

REVOKE SELECT (pay_rate_cents) ON public.memberships FROM authenticated;

-- service_role implicitly has all privileges, but spell it out for
-- clarity and so a future role-rename / Supabase migration doesn't
-- accidentally drop access.
GRANT SELECT (pay_rate_cents) ON public.memberships TO service_role;
