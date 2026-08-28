-- Org-level pay period schedule — meeting deliverable #3, finally unblocked.
--
-- Brian's definition: "my pay period could always be the first to the
-- fifteenth and the sixteenth to the end of month." The Payroll page's
-- "Up next" card computes its suggested period from this instead of
-- "day after the last run"; the owner stops typing dates forever.
--
-- NULL pay_schedule = manual (today's behavior, and the default for every
-- existing org — nothing changes until an owner picks a schedule).
--
-- pay_anchor is only meaningful for weekly/biweekly: any date that WAS a
-- real period start; periods are counted in exact 7/14-day steps from it.
-- Semimonthly (1–15, 16–end) and monthly need no anchor.

alter table public.organizations
  add column if not exists pay_schedule text
    check (pay_schedule in ('semimonthly', 'biweekly', 'weekly', 'monthly')),
  add column if not exists pay_anchor date;

comment on column public.organizations.pay_schedule is
  'Pay period cadence: semimonthly = 1st–15th & 16th–month-end; monthly = calendar month; weekly/biweekly = exact 7/14-day cycles from pay_anchor. NULL = owner picks dates by hand.';
comment on column public.organizations.pay_anchor is
  'Weekly/biweekly only: a date that was a real period start. Ignored for semimonthly/monthly.';

notify pgrst, 'reload schema';
