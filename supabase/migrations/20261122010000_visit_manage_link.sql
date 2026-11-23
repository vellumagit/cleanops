-- A private link to one visit, for the client it belongs to.
--
-- WHY
-- A client could only see or change a visit by signing in to the portal.
-- Their booking emails said "Need to reschedule? Reply to this email." The
-- easiest door for a client is the message they already have: one button
-- that opens that exact visit, with no sign-in (docs/online-booking-roadmap.md,
-- "How a client gets in").
--
-- NOW
-- bookings.manage_token is an unguessable token, made the first time a
-- message about the visit is sent. /v/<token> shows that one visit and lets
-- the client leave a note, ask to move it, or cancel it. NULL means no link
-- has been made, which is every visit that exists today.
--
-- Stored as it is, like invoices.public_token and estimates.public_token:
-- the link has to be put in later emails too (the reminder, a reschedule),
-- so it must be readable back. It opens one visit of one client, nothing
-- else.
--
-- Run BEFORE the code push: sending a booking email reads and writes this
-- column. Idempotent. Changes no existing rows.

begin;

alter table public.bookings add column if not exists manage_token text;

create unique index if not exists bookings_manage_token_uidx
  on public.bookings (manage_token)
  where manage_token is not null;

comment on column public.bookings.manage_token is
  'Unguessable token for the client''s private link to this one visit (/v/<token>). Null until a message about the visit is first sent. See src/lib/visit-link.ts.';

commit;

notify pgrst, 'reload schema';
