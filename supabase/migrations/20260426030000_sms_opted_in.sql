-- =============================================================================
-- SMS opt-in tracking on clients
-- =============================================================================
-- TCPA (US) and CASL (Canada) require explicit prior consent before sending
-- marketing or transactional SMS to a consumer. This column tracks whether
-- the client has given that consent.
--
-- DEFAULT false so all existing clients start un-opted-in. Org owners must
-- collect consent (via the client edit form checkbox) before the platform
-- will send SMS to a client even if TWILIO_ENABLED=true.
--
-- The sendOrgSms() gate in src/lib/sms.ts reads this column before every
-- client-facing outbound SMS and skips the send when it's false.
-- =============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sms_opted_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.sms_opted_in IS
  'True when the client has given explicit consent to receive SMS messages
   from the org (required by TCPA/CASL). Defaults to false — owners must
   collect and record consent before the platform will send texts. Checked
   by sendOrgSms() in src/lib/sms.ts before every client-facing outbound
   SMS.';
