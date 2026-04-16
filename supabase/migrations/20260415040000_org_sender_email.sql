-- =============================================================================
-- Organization sender email + verification
-- =============================================================================
-- Lets each org verify a custom From email for outgoing notifications.
-- Until verified, emails are sent from noreply@sollos3.com.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sender_email              text,
  ADD COLUMN IF NOT EXISTS sender_email_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS sender_email_token        text;

COMMENT ON COLUMN public.organizations.sender_email IS
  'Custom From address for outgoing emails. Must be verified (not a freemail).';
COMMENT ON COLUMN public.organizations.sender_email_token IS
  'One-time verification token. Cleared after successful verification.';
