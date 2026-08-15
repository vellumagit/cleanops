-- =============================================================================
-- One series, one visit per timeslot — enforced by the database
-- supabase/migrations/20260815010000_series_occurrence_unique.sql
-- =============================================================================
-- Nothing prevented two bookings in the same series at the same instant.
-- The nightly extend cron racing itself, or racing a series edit, could
-- insert the same dates twice — and each duplicate is a real confirmed
-- visit that auto-completes and auto-invoices SEPARATELY (the per-booking
-- invoice index can't help; they are distinct rows). Production already
-- carries two such pairs from April/May.
--
-- Order matters inside this file: dedup first, index second. The dedup
-- keeps the OLDEST row of each duplicate group and deletes younger ones
-- ONLY when they are unreferenced (no invoice, no time entry) — if a
-- referenced duplicate ever exists, it is skipped and the CREATE UNIQUE
-- INDEX below fails loudly rather than this file deleting history.
-- (Both current production pairs verified unreferenced on 2026-08-15.)
--
-- Standalone bookings are untouched: series_id NULL rows never collide
-- because unique indexes treat NULLs as distinct.

with ranked as (
  select id,
         row_number() over (
           partition by series_id, scheduled_at
           order by created_at asc, id asc
         ) as rn
  from public.bookings
  where series_id is not null
)
delete from public.bookings b
using ranked r
where b.id = r.id
  and r.rn > 1
  and not exists (select 1 from public.invoices i where i.booking_id = b.id)
  and not exists (select 1 from public.time_entries t where t.booking_id = b.id);

create unique index if not exists bookings_series_occurrence_uidx
  on public.bookings (series_id, scheduled_at);

comment on index public.bookings_series_occurrence_uidx is
  'A series can hold at most one booking per instant. Writers upsert with ignoreDuplicates against this index, so the extend cron racing a series edit skips instead of double-booking (and double-invoicing).';

notify pgrst, 'reload schema';
