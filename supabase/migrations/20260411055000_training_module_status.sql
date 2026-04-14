-- -----------------------------------------------------------------------------
-- Add status column to training_modules
--
-- The auto_assign_training() trigger in 20260411060000_automations.sql
-- queries WHERE status = 'published'. This column must exist before that
-- trigger is created.
-- -----------------------------------------------------------------------------

ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

COMMENT ON COLUMN public.training_modules.status IS 'draft | published — only published modules are auto-assigned to new employees.';
