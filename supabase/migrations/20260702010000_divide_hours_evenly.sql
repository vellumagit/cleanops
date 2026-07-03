-- Per-booking flag: when a team is assigned, show each cleaner their SHARE of
-- the job's hours (total ÷ crew) in the field app instead of the full duration.
-- Purely a display/estimate: does NOT change the booking's window, payroll
-- (which comes from clock-in/out), or the client's bill (a fixed price).
alter table public.bookings
  add column if not exists divide_hours_evenly boolean not null default false;
