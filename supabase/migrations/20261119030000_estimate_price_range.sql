-- Estimates: a price can be a range.
--
-- WHY
-- An estimate's lines each had one price and the estimate one total. Asked
-- for in person on 2026-11-19: quoting "between 300 and 400" before the
-- home has been seen, as a tick on the estimate.
--
-- NOW
-- The existing columns stay the low end (and the whole price, for a fixed
-- one). Two new columns hold the high end:
--   estimate_line_items.unit_price_high_cents  the top of that line's range
--   estimates.total_high_cents                 the top of the total
-- NULL means a fixed price, which is every estimate that exists today.
--
-- A line's high end can't be below its low end. The estimate's own pair is
-- NOT checked against each other on purpose: total_cents has other writers
-- (the API, the website's request form) that know nothing about ranges, and
-- a check would turn their saves into errors. The app treats a high end
-- that is not above the low end as "no range".
--
-- Run BEFORE the code push: the estimate pages read these columns.
-- Idempotent. Changes no existing rows.

begin;

alter table public.estimates
  add column if not exists total_high_cents integer
    check (total_high_cents is null or total_high_cents >= 0);

alter table public.estimate_line_items
  add column if not exists unit_price_high_cents integer
    check (unit_price_high_cents is null or unit_price_high_cents >= unit_price_cents);

commit;
