-- =============================================================================
-- Subcontractor bench SMS opt-out (TCPA/CTIA compliance)
-- =============================================================================
-- The inbound-SMS handler previously recorded STOP only against clients, so a
-- bench subcontractor replying STOP was never marked opted-out and could still
-- be included in shift-offer broadcasts. This adds the opt-out marker the
-- inbound handler now sets and the dispatch path now filters on.
--
-- Nullable: NULL = not opted out (the default). Set to a timestamp on STOP,
-- cleared back to NULL on START.
-- =============================================================================

alter table public.freelancer_contacts
  add column if not exists sms_opted_out_at timestamptz;

comment on column public.freelancer_contacts.sms_opted_out_at is
  'When set, this bench contact replied STOP — exclude from ALL SMS broadcasts (TCPA/CTIA opt-out). Cleared on START.';
