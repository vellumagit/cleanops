-- =============================================================================
-- Audit T5: make "blank = disable" thresholds actually disable
-- =============================================================================
-- The thresholds form documents blank as "disabled for this org" and stores
-- NULL — but every hygiene cron did `?? default`, so blanking a field still
-- expired/voided/completed/archived at the default. The crons now SKIP on
-- NULL. To keep that safe, NULL must only ever mean "explicitly blanked":
--   1. Column defaults are set, so new orgs start with working values.
--   2. Existing NULLs (orgs that never opened the form and expect the coded
--      defaults) are backfilled to those same defaults — behaviour unchanged.
-- =============================================================================

alter table public.organizations
  alter column stale_estimate_expire_days set default 30,
  alter column invoice_void_days set default 90,
  alter column booking_auto_complete_hours set default 24,
  alter column archive_after_days set default 730;

update public.organizations set stale_estimate_expire_days = 30 where stale_estimate_expire_days is null;
update public.organizations set invoice_void_days = 90 where invoice_void_days is null;
update public.organizations set booking_auto_complete_hours = 24 where booking_auto_complete_hours is null;
update public.organizations set archive_after_days = 730 where archive_after_days is null;
