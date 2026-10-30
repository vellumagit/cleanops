-- =============================================================================
-- Auto-void waits a year, not 90 days
-- =============================================================================
-- Voiding writes off money, and 90 days past due is an ordinary slow payer, not
-- a dead debt: Sollos voided seven unpaid Svit invoices this way before anyone
-- noticed. The automation's toggle stays the real switch (off by default, so
-- Sollos never voids unless an owner turns it on); this only changes how long
-- it waits when it is on.
--
-- Orgs still on the old 90 default move to a year. An org that chose its own
-- number keeps it, and blank (disabled) stays blank.
-- =============================================================================

alter table public.organizations
  alter column invoice_void_days set default 365;

update public.organizations
   set invoice_void_days = 365
 where invoice_void_days = 90;

comment on column public.organizations.invoice_void_days is
  'When the auto_void_overdue_invoices automation is on, an unpaid invoice this many days past due is voided. Default 365. NULL disables it for this org. With the automation off (the default) this does nothing.';
