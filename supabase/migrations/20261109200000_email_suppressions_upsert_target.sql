-- =============================================================================
-- The suppression upsert has never worked; this gives it an index it can name.
--
-- addEmailSuppression upserts with `onConflict: "email"`, which PostgREST turns
-- into ON CONFLICT (email). The only unique index on the address was on
-- lower(email) — an expression — and ON CONFLICT cannot target an expression
-- index by naming the column, so Postgres answered 42P10 ("no unique or
-- exclusion constraint matching the ON CONFLICT specification"). Every bounce
-- and complaint Resend delivered since 2026-06-02 hit that error; the webhook
-- logged it and answered 200, so nobody saw it and no address was ever
-- suppressed. Fail-closed (e459635, 2026-11-09) turned the same failure into a
-- 500 within the hour, which is how it surfaced.
--
-- The app lowercases and trims before every write and every lookup, so a
-- plain unique index on email is the same rule in a form the upsert can name.
-- The CHECK keeps that true from the database side.
-- =============================================================================

drop index if exists public.email_suppressions_email_uidx;

create unique index if not exists email_suppressions_email_uidx
  on public.email_suppressions (email);

alter table public.email_suppressions
  drop constraint if exists email_suppressions_email_normalized;
alter table public.email_suppressions
  add constraint email_suppressions_email_normalized
  check (email = lower(btrim(email)));
