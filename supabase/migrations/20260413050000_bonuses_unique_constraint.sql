-- Prevent duplicate bonus rows from concurrent computation runs.
-- A given employee can only have one bonus of each type per period per org.

CREATE UNIQUE INDEX IF NOT EXISTS bonuses_unique_period_uidx
  ON bonuses (organization_id, employee_id, period_start, period_end, bonus_type);
