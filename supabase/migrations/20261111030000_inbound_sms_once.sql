-- One saved row per incoming text (2026-11-11).
--
-- The inbound webhook checks for the message's Twilio SID before saving a
-- reply, but two deliveries of the same message arriving together can both
-- pass that check. This makes the second insert fail with 23505, which the
-- webhook reads as "already have it" (lib/sms-inbound-reply.ts). The office
-- notification was already once-only (notifications_one_fact_per_person).
--
-- Inbound only: outbound rows don't record a SID. Safe before or after the
-- push; the code works with or without it. On 2026-11-11 production had no
-- inbound rows, so nothing can block the index.

create unique index if not exists sms_messages_inbound_sid_key
  on public.sms_messages (organization_id, twilio_sid)
  where direction = 'inbound' and twilio_sid is not null;
