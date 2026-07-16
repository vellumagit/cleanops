-- Simplify the booking lifecycle to: confirmed → in_progress → completed,
-- or cancelled.
--
-- 'pending' and 'en_route' are retired. The enum VALUES stay (Postgres can't
-- cleanly drop enum members without recreating the type + every dependent
-- column), but nothing produces them anymore and the UI no longer offers them.

-- Migrate existing rows off the retired statuses. 'pending' (not-yet-confirmed
-- internal bookings) and 'en_route' (never actually used) both collapse into
-- 'confirmed'. In-progress / completed / cancelled are untouched.
update public.bookings
set status = 'confirmed'
where status in ('pending', 'en_route');

-- New bookings default to confirmed.
alter table public.bookings alter column status set default 'confirmed';

notify pgrst, 'reload schema';
