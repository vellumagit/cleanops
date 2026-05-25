-- Add split segment metadata to booking_assignees.
-- This makes booking_assignees the single source of truth for split shifts:
-- each segment employee gets a row with their start offset and duration.
-- NULL values = non-split (regular) assignment.

ALTER TABLE booking_assignees
  ADD COLUMN IF NOT EXISTS split_index                int,
  ADD COLUMN IF NOT EXISTS split_start_offset_minutes int,
  ADD COLUMN IF NOT EXISTS split_duration_minutes     int;

-- Backfill: for every booking that has splits, rebuild booking_assignees
-- from the splits JSONB so existing data works without a manual fix.
DO $$
DECLARE
  r   RECORD;
  seg JSONB;
  idx INT;
  off INT;
  mid UUID;
  dur INT;
BEGIN
  FOR r IN
    SELECT id, organization_id, splits
    FROM   bookings
    WHERE  splits IS NOT NULL
      AND  jsonb_array_length(splits) > 0
  LOOP
    -- Wipe existing assignees for this booking; we'll rebuild from splits.
    DELETE FROM booking_assignees WHERE booking_id = r.id;

    idx := 0;
    off := 0;

    FOR seg IN SELECT * FROM jsonb_array_elements(r.splits)
    LOOP
      mid := (seg->>'assigned_to')::uuid;
      dur := COALESCE((seg->>'duration_minutes')::int, 0);

      IF mid IS NOT NULL THEN
        INSERT INTO booking_assignees (
          organization_id, booking_id, membership_id, is_primary,
          split_index, split_start_offset_minutes, split_duration_minutes
        ) VALUES (
          r.organization_id, r.id, mid,
          idx = 0,
          idx, off, dur
        )
        ON CONFLICT (booking_id, membership_id) DO UPDATE SET
          is_primary                  = EXCLUDED.is_primary,
          split_index                 = EXCLUDED.split_index,
          split_start_offset_minutes  = EXCLUDED.split_start_offset_minutes,
          split_duration_minutes      = EXCLUDED.split_duration_minutes;

        -- Keep bookings.assigned_to pointing at segment-0 employee
        IF idx = 0 THEN
          UPDATE bookings SET assigned_to = mid WHERE id = r.id;
        END IF;
      END IF;

      off := off + dur;
      idx := idx + 1;
    END LOOP;
  END LOOP;
END $$;
