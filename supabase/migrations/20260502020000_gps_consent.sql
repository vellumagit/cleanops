-- =============================================================================
-- GPS / location-tracking consent
-- =============================================================================
-- Employees must acknowledge that their GPS coordinates are recorded on
-- clock-in and clock-out before the field app issues its first location
-- request. This satisfies GDPR Art. 6/7 (lawful basis + consent for
-- location processing) and common labour-law transparency requirements.
--
-- The field app layout checks this column on every load and renders a
-- sticky notice until the employee taps "Got it". Server action
-- acceptGpsConsentAction() stamps the timestamp.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS gps_consent_accepted_at timestamptz;

COMMENT ON COLUMN public.memberships.gps_consent_accepted_at IS
  'Timestamp when the employee acknowledged that GPS coordinates are recorded on clock-in / clock-out. NULL = consent not yet given; the field app shows a notice until it is set.';
