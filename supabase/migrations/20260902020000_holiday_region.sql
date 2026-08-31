-- Org holiday region — statutory holidays on the scheduler.
--
-- Brian (Aug 30 meeting): show holidays on the calendar. No Google
-- import, no API: statutory holidays are pure calendar math, computed
-- offline by the date-holidays library from one org-level region code.
-- Format: ISO country ("CA") or country-subdivision ("CA-AB").
-- NULL = feature off, which is also the default for existing orgs.

alter table public.organizations
  add column if not exists holiday_region text
    check (holiday_region is null or holiday_region ~ '^[A-Z]{2}(-[A-Z0-9]{1,4})?$');

comment on column public.organizations.holiday_region is
  'ISO region for statutory holidays shown on the scheduler: "CA" or "CA-AB". NULL = holidays off.';

notify pgrst, 'reload schema';
