-- Recurring invoices can charge tax.
--
-- WHY
-- A recurring invoice held one amount and nothing about tax, so every
-- invoice it generated went out untaxed, whatever the company's tax setting
-- said. The form now has a "Charge tax" option; these two columns hold it.
--
-- amount_cents on the series stays the amount BEFORE tax. The generator adds
-- the tax to each invoice it makes, the same way a finished job's invoice
-- gets the company's default tax.
--
-- NULL rate = no tax, which is every series that exists today: nothing about
-- them changes until someone edits one and turns tax on.
--
-- Run BEFORE the code push: the new form saves these columns. Idempotent.

begin;

alter table public.invoice_series
  add column if not exists tax_rate_bps integer,
  add column if not exists tax_label text;

alter table public.invoice_series
  drop constraint if exists invoice_series_tax_rate_bps_range;
alter table public.invoice_series
  add constraint invoice_series_tax_rate_bps_range
  check (tax_rate_bps is null or (tax_rate_bps > 0 and tax_rate_bps <= 9999));

comment on column public.invoice_series.tax_rate_bps is
  'Tax rate in basis points (500 = 5%) added to each generated invoice. NULL = no tax.';
comment on column public.invoice_series.tax_label is
  'What the tax is called on the invoice, e.g. GST.';

commit;
