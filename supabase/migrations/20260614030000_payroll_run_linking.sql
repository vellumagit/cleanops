-- Prevent payroll double-pay.
--
-- A payroll run summed time_entries + pending bonuses by date range but
-- never marked them as consumed, so an overlapping run (the form defaults
-- to "last 14 days") re-paid the same hours, and a bonus could be paid in a
-- run AND marked paid separately. Link each consumed row to its run; new
-- runs exclude already-linked rows. ON DELETE SET NULL means deleting a
-- draft run automatically frees its rows for a future run.

alter table public.time_entries
  add column if not exists payroll_run_id uuid
    references public.payroll_runs(id) on delete set null;

alter table public.bonuses
  add column if not exists payroll_run_id uuid
    references public.payroll_runs(id) on delete set null;

create index if not exists time_entries_payroll_run_idx
  on public.time_entries (payroll_run_id);
create index if not exists bonuses_payroll_run_idx
  on public.bonuses (payroll_run_id);
