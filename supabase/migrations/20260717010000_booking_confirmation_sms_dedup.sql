-- Independent dedup stamp for the booking-confirmation SMS.
--
-- The confirmation SMS used to piggyback on the email path: it only fired
-- inside sendBookingConfirmation AFTER the email checks passed (client has an
-- email, booking_confirmation_email toggle on — which is default-OFF, email not
-- already sent). So an org that enabled only the SMS toggle never got a
-- confirmation text. Decoupling the SMS means it needs its own "already sent"
-- marker so a retry / double-submit doesn't text the client twice.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS confirmation_sms_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.confirmation_sms_sent_at IS
  'When the booking-confirmation SMS was sent. Independent of confirmation_email_sent_at so the SMS channel dedups on its own and sends even when the email channel is off/unused.';

NOTIFY pgrst, 'reload schema';
