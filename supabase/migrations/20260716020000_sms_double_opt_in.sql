-- Double opt-in for client SMS: track when a confirmation request was sent.
--
-- Flow: an owner/admin sends a one-time opt-in request text ("Reply YES to get
-- updates"). We stamp sms_opt_in_requested_at. The client replies YES, and the
-- inbound handler flips clients.sms_opted_in true (recorded consent). Until they
-- reply, sms_opted_in stays false and no automated texts send.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sms_opt_in_requested_at timestamptz;

COMMENT ON COLUMN public.clients.sms_opt_in_requested_at IS
  'When a double opt-in SMS request was last sent to this client. Consent is only granted when they reply YES (inbound handler sets sms_opted_in true); this column just marks the pending "awaiting reply" state.';

NOTIFY pgrst, 'reload schema';
