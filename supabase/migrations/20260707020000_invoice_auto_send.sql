-- Invoice auto-send — draft now, ship automatically after a review window.
--
-- Both draft paths (per-job autoInvoiceOnJobComplete + the biweekly/monthly
-- billing-cycle cron) currently leave a DRAFT for a human to send. This adds an
-- opt-in per-org setting to auto-send those drafts after a configurable delay
-- (default 24h), with a hold/send-now escape hatch. A new hourly cron sweeps
-- scheduled drafts whose window has elapsed. See src/lib/invoice-send.ts.

-- ── organizations: auto-send config (opt-in) ────────────────────────────────
alter table public.organizations
  add column if not exists invoice_auto_send_enabled       boolean not null default false,
  add column if not exists invoice_auto_send_delay_hours    integer not null default 24,
  add column if not exists invoice_auto_send_consolidated   boolean not null default true;

comment on column public.organizations.invoice_auto_send_enabled is
  'Master switch: auto-send drafted invoices after a review window. Opt-in (default off).';
comment on column public.organizations.invoice_auto_send_delay_hours is
  'Review window before an auto-drafted invoice sends itself. 0 = send on next cron pass.';
comment on column public.organizations.invoice_auto_send_consolidated is
  'Whether biweekly/monthly consolidated invoices also auto-send (under the master switch).';

-- ── invoices: per-invoice auto-send schedule + lifecycle ────────────────────
alter table public.invoices
  add column if not exists auto_send_at     timestamptz,
  add column if not exists auto_send_state  text
    check (auto_send_state in ('scheduled', 'held', 'sent', 'skipped'));

comment on column public.invoices.auto_send_at is
  'When this draft should auto-send. Null = never scheduled (manual send).';
comment on column public.invoices.auto_send_state is
  'scheduled = will auto-send at auto_send_at; held = owner cancelled auto-send; sent/skipped = terminal.';

-- Cron sweep hot path: find due, still-scheduled drafts.
create index if not exists invoices_auto_send_due_idx
  on public.invoices (auto_send_state, auto_send_at)
  where auto_send_state = 'scheduled';

notify pgrst, 'reload schema';
