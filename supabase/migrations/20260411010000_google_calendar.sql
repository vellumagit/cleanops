-- =============================================================================
-- Google Calendar integration
--
-- Adds google_calendar to the integration_provider enum and a
-- google_calendar_event_id column on bookings so we can track the 1:1
-- mapping between a Sollos booking and its Google Calendar event.
-- =============================================================================

-- Add 'google_calendar' to the integration_provider enum.
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'google_calendar'
      and enumtypid = 'public.integration_provider'::regtype
  ) then
    alter type public.integration_provider add value 'google_calendar';
  end if;
end $$;

-- Track which Google Calendar event corresponds to each booking.
alter table public.bookings
  add column if not exists google_calendar_event_id text;

comment on column public.bookings.google_calendar_event_id is
  'The Google Calendar event id for this booking. Set when the booking is synced to the connected calendar.';
