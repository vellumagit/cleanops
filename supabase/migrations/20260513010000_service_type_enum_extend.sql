-- Extend service_type enum with appointment / consultation types.
--
-- The original enum only had cleaning-specific values. These additions
-- let owners schedule meetings, consultations, walkthroughs, and
-- catch-all "other" jobs without hacking the existing values.
--
-- ALTER TYPE … ADD VALUE cannot run inside a transaction block, so
-- we use a DO block with a conditional check to keep it idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.service_type'::regtype
      AND enumlabel = 'meeting'
  ) THEN
    ALTER TYPE public.service_type ADD VALUE 'meeting';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.service_type'::regtype
      AND enumlabel = 'consultation'
  ) THEN
    ALTER TYPE public.service_type ADD VALUE 'consultation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.service_type'::regtype
      AND enumlabel = 'walkthrough'
  ) THEN
    ALTER TYPE public.service_type ADD VALUE 'walkthrough';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.service_type'::regtype
      AND enumlabel = 'other'
  ) THEN
    ALTER TYPE public.service_type ADD VALUE 'other';
  END IF;
END $$;
