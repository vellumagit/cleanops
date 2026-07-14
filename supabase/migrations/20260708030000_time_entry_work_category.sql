-- Label standalone (no-booking) clock-ins so "manager / admin" time is
-- distinguishable from on-a-job time in timesheets + payroll.
--
-- Job-tied entries (booking_id set) are cleaning work and leave this null;
-- the field-app Clock tab (no booking) captures a category.

alter table public.time_entries
  add column if not exists work_category text;

comment on column public.time_entries.work_category is
  'Standalone clock-in category (manager, admin, training, travel, supplies, other). Null for job-tied entries.';

notify pgrst, 'reload schema';
