-- ---------------------------------------------------------------------------
-- Efficiency bonuses — reward employees who consistently finish jobs
-- faster than estimated.
--
-- Adds efficiency config columns to `bonus_rules` and a `bonus_type`
-- column to `bonuses` so the UI can distinguish review-based from
-- efficiency-based awards.
-- ---------------------------------------------------------------------------

-- Extend bonus_rules with efficiency thresholds
alter table public.bonus_rules
  add column if not exists efficiency_enabled      boolean  not null default false,
  add column if not exists efficiency_min_hours_saved numeric(6,2) not null default 5.00,
  add column if not exists efficiency_min_jobs      integer  not null default 10,
  add column if not exists efficiency_amount_cents   integer  not null default 2500;

comment on column public.bonus_rules.efficiency_enabled is 'Whether efficiency bonuses are turned on.';
comment on column public.bonus_rules.efficiency_min_hours_saved is 'Minimum total hours saved in the period to qualify.';
comment on column public.bonus_rules.efficiency_min_jobs is 'Minimum completed jobs with time entries in the period.';
comment on column public.bonus_rules.efficiency_amount_cents is 'Flat bonus amount (cents) for qualifying employees.';

-- Add bonus_type to bonuses so the table can show the source
alter table public.bonuses
  add column if not exists bonus_type text not null default 'review';

comment on column public.bonuses.bonus_type is 'review | efficiency — what triggered this bonus.';
