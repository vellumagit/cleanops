-- =============================================================================
-- Sometimes the tip really is for the house
-- supabase/migrations/20260902040000_invoice_tips_kept.sql
-- =============================================================================
-- The tips ledger has exactly one exit: paid_out_at, meaning "handed to the
-- person". But not every tip is meant for a cleaner — a client tips "for the
-- great service" meaning the owner, or the tip lands unattributed because
-- nobody was assigned, or it was simply a mistake worth absorbing. Until now
-- the only honest options were to leave it hanging as owed forever or to lie
-- with "Mark paid".
--
-- kept_by_business is the second exit. It is set TOGETHER with paid_out_at —
-- a kept tip is settled (it must leave the "what do we still owe" ledger, or
-- it nags forever), it just never left the business. Every owed query keys on
-- paid_out_at IS NULL and needs no change; history can now tell the two
-- resolutions apart.

alter table public.invoice_tips
  add column if not exists kept_by_business boolean not null default false;

comment on column public.invoice_tips.kept_by_business is
  'TRUE = an owner resolved this tip into the business instead of passing it to a cleaner (meant for the owner, unattributable, or a correction). Always set together with paid_out_at: kept = settled-but-not-handed-over. FALSE with paid_out_at set = actually paid to the person.';

notify pgrst, 'reload schema';
