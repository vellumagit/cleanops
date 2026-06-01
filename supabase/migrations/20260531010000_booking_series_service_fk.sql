-- Add service_type_id + service_type_label to booking_series.
--
-- The 20260530010000_service_types migration added these to bookings
-- and contracts but missed booking_series. Two consequences:
--
--   1. The "this and future" propagation path in updateBookingAction
--      spreads propagatableFields (which includes service_type_id +
--      service_type_label) into a booking_series UPDATE. PostgREST
--      errors on unknown columns, silently breaking series template
--      updates.
--
--   2. The extend-series cron generates new occurrences from the
--      series row but only reads service_type (enum). Every cron-
--      generated booking ends up with NULL service_type_id and NULL
--      service_type_label, so its display falls back to humanizing
--      the enum instead of showing the org's custom service name.
--
-- This migration adds the columns and backfills from the most recent
-- booking in each series (since the series row was created before the
-- columns existed and the form didn't populate them on insert).

ALTER TABLE public.booking_series
  ADD COLUMN IF NOT EXISTS service_type_id    uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_type_label text;

CREATE INDEX IF NOT EXISTS booking_series_service_type_id_idx
  ON public.booking_series (service_type_id);

-- Backfill: for each series, copy the FK + label from one of its
-- bookings. Any booking in the series will do — the form forces them
-- all to share the same service. Pick the most recent so a series that
-- had its bookings updated post-migration carries the latest values.
WITH latest_booking_per_series AS (
  SELECT DISTINCT ON (series_id)
    series_id, service_type_id, service_type_label
  FROM public.bookings
  WHERE series_id IS NOT NULL
    AND service_type_id IS NOT NULL
  ORDER BY series_id, scheduled_at DESC
)
UPDATE public.booking_series bs
SET
  service_type_id    = lb.service_type_id,
  service_type_label = lb.service_type_label
FROM latest_booking_per_series lb
WHERE bs.id = lb.series_id
  AND bs.service_type_id IS NULL;
