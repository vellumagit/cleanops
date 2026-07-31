-- Add the notification types the app has been trying to send since day one.
--
-- notifications.type is an enum with only four members: review_request,
-- low_inventory, unfilled_shift, general. The app calls notify() with EIGHT
-- distinct types, so seven of them fail the INSERT with
--   22P02 invalid input value for enum notification_type
--
-- Nothing surfaced it. The insert result is discarded (cast to
-- Promise<unknown>) and notify() wraps its whole body in try/catch, so the
-- error was swallowed twice. And because the push send happens AFTER the
-- insert inside that same try block, a failed insert also killed the push.
--
-- Net effect: forgotten-clock-out nags, auto-close alerts, shift-claimed,
-- unstaffed-past-booking, SMS cap warnings, invoice auto-send failures and
-- calendar-disconnect notices have NEVER produced an in-app notification or
-- a web push. Not once, in any org.
--
-- Confirmed live: a shift capped at 19:00 on 2026-07-31 wrote no notification
-- row, and `select ... where type = 'shift_auto_closed'` errors rather than
-- returning zero rows, because the literal is not a valid enum member.
--
-- ALTER TYPE … ADD VALUE cannot run inside a transaction block, so each is a
-- conditional DO block, matching 20260513010000_service_type_enum_extend.sql.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'clock_out_reminder'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'clock_out_reminder';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'shift_auto_closed'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'shift_auto_closed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'shift_claimed'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'shift_claimed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'unstaffed_past_booking'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'unstaffed_past_booking';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'sms_cap'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'sms_cap';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'invoice_auto_send_failed'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'invoice_auto_send_failed';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'calendar_disconnected'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'calendar_disconnected';
  END IF;
END $$;
