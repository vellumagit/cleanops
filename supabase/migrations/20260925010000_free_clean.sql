-- A $0 booking that is deliberately free, told apart from one nobody priced.
--
-- The bookings list warns "No price" on any non-terminal job with total_cents
-- = 0 and no hourly rate, because such a job never produces an invoice. That
-- is right for a job somebody forgot to price and wrong for a comp clean, and
-- the two are identical in the data — so Svitlana gets a yellow warning every
-- time she gives one away, on a job that is exactly as intended.
--
-- Intent cannot be inferred from the amount, so it needs recording. Default
-- false: every existing $0 booking keeps warning, which is the safe direction.
-- Someone marking one free is an explicit act.

alter table public.bookings
  add column if not exists is_free boolean not null default false;

comment on column public.bookings.is_free is
  'Deliberately free of charge (comp clean, make-good, referral thank-you). '
  'Suppresses the "No price" warning and shows as "Free" instead of $0.00. '
  'Purely a statement of intent — the amount still lives in total_cents, '
  'which is expected to be 0 when this is true.';

notify pgrst, 'reload schema';
