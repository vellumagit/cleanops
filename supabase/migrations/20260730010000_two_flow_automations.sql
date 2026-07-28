-- Two permanent flows (client / internal) replace the all-clients/per-client
-- routing-mode switch. One rule everywhere now: the org toggle turns a client
-- message type on, then the house default + each client's own settings decide
-- delivery.
--
-- Grandfather orgs that were in per_client mode so behavior is IDENTICAL:
--   * their client-facing org toggles were bypassed (treated as on while the
--     master switch was on) -> write enabled:true explicitly
--   * their unconfigured ("inherit") clients received nothing -> house
--     default becomes 'none'
-- Configured clients keep their own settings either way; nothing changes in
-- what actually sends.
--
-- organizations.automation_mode stays as a dead column (no code reads it).

update public.organizations
set
  automation_settings = coalesce(automation_settings, '{}'::jsonb) || jsonb_build_object(
    'booking_confirmation_email',      jsonb_build_object('enabled', true),
    'booking_confirmation_sms',        jsonb_build_object('enabled', true),
    'booking_rescheduled_email',       jsonb_build_object('enabled', true),
    'booking_rescheduled_sms',         jsonb_build_object('enabled', true),
    'booking_cancelled_email',         jsonb_build_object('enabled', true),
    'booking_cancelled_sms',           jsonb_build_object('enabled', true),
    'booking_reminder_client_email',   jsonb_build_object('enabled', true),
    'booking_reminder_client_sms',     jsonb_build_object('enabled', true),
    'invoice_overdue_reminder',        jsonb_build_object('enabled', true),
    'invoice_paid_receipt',            jsonb_build_object('enabled', true),
    'review_request_after_completion', jsonb_build_object('enabled', true),
    'gbp_review_request',              jsonb_build_object('enabled', true),
    'rebooking_prompt_email',          jsonb_build_object('enabled', true),
    'estimate_followup_email',         jsonb_build_object('enabled', true)
  ),
  default_contact_preference = 'none'
where automation_mode = 'per_client';
