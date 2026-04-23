-- =============================================================================
-- Organization contact info for invoices / public pages
-- =============================================================================
-- Separate from sender_email (which controls the From address for our
-- outgoing mail) and from the org's name/address. This is what we show
-- the *client* on invoices and the public invoice page so they can
-- actually reach the business when they have a question — previously
-- the public invoice page ended with "reply to the email this invoice
-- came from", which is a black hole since we send from noreply@sollos3.
--
-- These are org-level (not per-invoice) because cleaning businesses
-- almost never change their contact info job-to-job.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;

COMMENT ON COLUMN public.organizations.contact_email IS
  'Email clients should reply to with invoice / booking questions. Shown on public invoice pages and used as Reply-To on outgoing client emails.';
COMMENT ON COLUMN public.organizations.contact_phone IS
  'Phone number clients can call with invoice / booking questions. Shown on public invoice pages. Free-form text (E.164 not enforced).';
