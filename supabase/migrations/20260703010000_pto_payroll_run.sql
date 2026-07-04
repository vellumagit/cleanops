-- Stamp approved PTO with the payroll run that paid it, so a later overlapping
-- (or re-created) run can't pay the same PTO twice — mirrors the existing
-- payroll_run_id columns on time_entries and bonuses. ON DELETE SET NULL so
-- deleting/un-posting a run releases its PTO to be paid again.
alter table public.pto_requests
  add column if not exists payroll_run_id uuid
    references public.payroll_runs(id) on delete set null;

create index if not exists pto_requests_payroll_run_idx
  on public.pto_requests (payroll_run_id);
