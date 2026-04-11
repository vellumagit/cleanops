-- -----------------------------------------------------------------------------
-- Onboarding tracking
--
-- Stores when the owner completed (dismissed) the setup checklist.
-- NULL means onboarding is still pending / should be shown.
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.organizations.onboarding_completed_at is
  'When the owner dismissed the setup checklist. NULL = still onboarding.';
