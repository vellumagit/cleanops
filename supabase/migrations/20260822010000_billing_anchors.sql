-- =============================================================================
-- Billing that starts on the client's day, not the calendar's
-- supabase/migrations/20260822010000_billing_anchors.sql
-- =============================================================================
-- The billing engine hardcoded its calendar: monthly meant the 1st, and
-- "biweekly" actually meant SEMIMONTHLY on the 1st and the 15th — the days
-- were baked into the cron schedule itself. Svitlana's ask is the thing the
-- model couldn't say: a client billed 15th → 15th, or 20th → 20th, or on a
-- true two-week cycle starting whenever the arrangement started.
--
-- Two columns because the cadences genuinely anchor differently:
--
--   billing_anchor_day    MONTHLY: the day of month the cycle turns over.
--                         Capped 1–28 so "the 31st in February" is
--                         unrepresentable rather than clamped — one less
--                         rule anyone has to hold in their head.
--
--   billing_anchor_date   BIWEEKLY: a start date, and it means it — exact
--                         14-day cycles from that date, forever. Not "twice
--                         a month".
--
-- BOTH NULL = every existing client keeps the legacy calendar exactly
-- (1st for monthly, 1st & 15th for biweekly, same labels, same idempotency
-- keys). Anchors only exist where an owner deliberately sets one.

alter table public.clients
  add column if not exists billing_anchor_day integer,
  add column if not exists billing_anchor_date date;

alter table public.clients
  drop constraint if exists clients_billing_anchor_day_check;
alter table public.clients
  add constraint clients_billing_anchor_day_check
  check (
    billing_anchor_day is null
    or (billing_anchor_day >= 1 and billing_anchor_day <= 28)
  );

comment on column public.clients.billing_anchor_day is
  'Monthly cadence only: day of month (1-28) the billing cycle turns over — a client with 15 is billed for the 15th through the 14th. NULL = legacy calendar month from the 1st. Capped at 28 so February needs no clamping rule.';

comment on column public.clients.billing_anchor_date is
  'Biweekly cadence only: exact 14-day cycles counted from this date. NULL = legacy semimonthly on the 1st and 15th. The first invoice goes out one full cycle after this date, never on it.';

notify pgrst, 'reload schema';
