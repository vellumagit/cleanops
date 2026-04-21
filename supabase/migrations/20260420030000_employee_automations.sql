-- Infrastructure for seven employee-facing automations.
--
-- New columns:
--   organizations.overtime_threshold_hours — per-org override for the
--     weekly-hours ceiling that triggers the Friday overtime warning.
--     Default 40.
--   training_modules.expires_after_days — how long a completed module
--     stays valid. NULL = no expiry.
--   training_assignments.certification_expires_at — concrete expiry
--     timestamp for this employee's certification on this module. Set
--     by a trigger when completed_at is populated and the module has
--     expires_after_days, OR set manually by the admin.
--   training_assignments.expiry_reminder_30d_sent_at,
--     expiry_reminder_7d_sent_at — dedup for the certification-expiry
--     cron so it doesn't spam the same reminder twice.
--
-- Idempotent — safe to re-run.

-- ── 1. Per-org overtime threshold ─────────────────────────────────
alter table public.organizations
  add column if not exists overtime_threshold_hours numeric(5,2) not null default 40;

comment on column public.organizations.overtime_threshold_hours is
  'Weekly-hours ceiling that triggers the Friday overtime warning email to employees approaching or past this threshold. Default 40.';

-- ── 2. Training module validity period ────────────────────────────
alter table public.training_modules
  add column if not exists expires_after_days integer check (expires_after_days is null or expires_after_days > 0);

comment on column public.training_modules.expires_after_days is
  'Validity period in days. When an assignment is marked completed, the trigger computes certification_expires_at = completed_at + this many days. NULL = never expires.';

-- ── 3. Per-assignment expiry + dedup columns ──────────────────────
alter table public.training_assignments
  add column if not exists certification_expires_at   timestamptz,
  add column if not exists expiry_reminder_30d_sent_at timestamptz,
  add column if not exists expiry_reminder_7d_sent_at  timestamptz;

comment on column public.training_assignments.certification_expires_at is
  'Computed on completion: completed_at + modules.expires_after_days. Admins may override manually. NULL = no expiry tracked for this assignment.';

-- Partial index for the expiry cron — only certifications that still expire.
create index if not exists training_assignments_expiry_lookup_idx
  on public.training_assignments (certification_expires_at)
  where certification_expires_at is not null;

-- ── 4. Trigger: compute certification_expires_at on completion ───
create or replace function public.training_compute_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  -- Only compute when completed_at transitions from NULL → set
  if new.completed_at is null or (old.completed_at is not null) then
    return new;
  end if;

  -- If admin has already set a manual expiry, leave it alone.
  if new.certification_expires_at is not null then
    return new;
  end if;

  -- Pull the module's validity period.
  select expires_after_days into v_days
    from public.training_modules where id = new.module_id;

  if v_days is not null and v_days > 0 then
    new.certification_expires_at := new.completed_at + make_interval(days => v_days);
  end if;

  return new;
end;
$$;

drop trigger if exists training_compute_expiry_trg on public.training_assignments;
create trigger training_compute_expiry_trg
  before update of completed_at on public.training_assignments
  for each row execute function public.training_compute_expiry();

-- ── 5. Trigger: reset reminder stamps if certification is renewed ─
-- When certification_expires_at changes (e.g. module retrained), clear
-- the sent-at stamps so the next-expiring reminder fires fresh.
create or replace function public.training_clear_expiry_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.certification_expires_at is distinct from old.certification_expires_at then
    new.expiry_reminder_30d_sent_at := null;
    new.expiry_reminder_7d_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists training_clear_expiry_reminders_trg on public.training_assignments;
create trigger training_clear_expiry_reminders_trg
  before update of certification_expires_at on public.training_assignments
  for each row execute function public.training_clear_expiry_reminders();
