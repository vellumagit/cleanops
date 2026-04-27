-- =============================================================================
-- Booking email dedup stamps
-- =============================================================================
-- Booking confirmation, rescheduled, and cancelled emails had no sent-at
-- dedup guard — a double-submit or server retry would email the client twice.
-- These columns mirror the pattern already used by client_reminder_sent_at
-- (the 24h-before reminder) and review_request_sent_at.
--
-- The automations check these before sending and stamp them atomically after
-- a successful send, so a second call is a no-op.
-- =============================================================================

-- Set when the initial booking confirmation email is sent to the client.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.confirmation_email_sent_at IS
  'Timestamp when the booking confirmation email was sent to the client.
   NULL = not yet sent. Checked before sending so a double-submit or
   server retry never produces a duplicate confirmation email.';

-- Set (and reset) each time a rescheduled-notice email is sent.
-- Stores the most recent send so operators can see when the client was
-- last notified of a time change.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rescheduled_email_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.rescheduled_email_sent_at IS
  'Timestamp of the most recent "booking rescheduled" email sent to the
   client. Reset on each reschedule so the client is always notified of
   the latest time change. NULL = no rescheduled email has been sent.';

-- Set when the cancellation email is sent.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_email_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.cancelled_email_sent_at IS
  'Timestamp when the booking cancellation email was sent to the client.
   NULL = not yet sent or booking was not cancelled.';
