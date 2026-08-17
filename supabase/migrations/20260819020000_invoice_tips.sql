-- =============================================================================
-- A tip is money for a person, arriving in the company's account
-- supabase/migrations/20260819020000_invoice_tips.sql
-- =============================================================================
-- Stripe has no tipping to lean on here. Its native tipping is a Terminal
-- feature — physical card readers — and the checkout our clients actually
-- click is a DESTINATION CHARGE minted by the platform account, so nothing
-- the connected account configures in their own dashboard reaches it. If we
-- want tips, we build tips.
--
-- The awkward part is not collecting the money, it is that the money lands in
-- the WRONG ACCOUNT by design. A destination charge sweeps the whole net into
-- the company's Stripe balance and then their bank. The cleaner the client
-- meant to thank never touches it. So the only thing that makes a tip real is
-- a durable record of who it was for, which is what this table is.
--
-- ONE ROW PER BENEFICIARY, not one row per tip with a JSON blob of names.
-- The question this table exists to answer is "what do we still owe Olha",
-- and that has to be a group-by, not an application-layer sum over parsed
-- JSON. A tip split across a crew of three is three rows.
--
-- Amounts are the SPLIT amounts and they sum to exactly what the client paid
-- — the split uses largest-remainder in src/lib/tip-split.ts precisely so no
-- cent is invented or lost on the way in.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The org-level switch
-- ─────────────────────────────────────────────────────────────────────────────
-- Off by default, and deliberately so: a tip prompt that appears without the
-- owner asking for it reads as the software begging on their behalf, in front
-- of their own client. This is the one automation-shaped setting where a
-- surprise is genuinely embarrassing, so absent = off.

alter table public.organizations
  add column if not exists tipping_settings jsonb;

comment on column public.organizations.tipping_settings is
  'Client tipping on the public invoice page: {"enabled":true,"presets":[15,18,20]}. NULL or absent = OFF — tipping never appears unless an owner turns it on. Presets are whole percents of the outstanding balance; the payer can always enter a custom amount or skip.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The record
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.invoice_tips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,

  -- Who it's for. NULL is legitimate and means "nobody could be resolved" —
  -- an invoice whose jobs have no assignee at all. The tip was still paid and
  -- still has to appear in the books, so we record it unattributed rather
  -- than dropping it on the floor and letting the money vanish from the
  -- ledger. The app shows these as needing a decision.
  membership_id uuid references public.memberships(id) on delete set null,

  amount_cents integer not null check (amount_cents > 0),

  -- What the split was based on, kept for explainability: when a cleaner asks
  -- why they got $7 of a $20 tip, the answer is here rather than re-derived
  -- from bookings that may since have been edited.
  share_minutes integer,

  provider text not null default 'stripe',
  provider_payment_id text,

  -- Settled through payroll. NULL = still owed.
  paid_out_at timestamptz,

  created_at timestamptz not null default now()
);

-- Stripe fires checkout.session.completed AND payment_intent.succeeded for one
-- payment, and retries both. Same discipline as invoice_payments: the first
-- write wins. Keyed per beneficiary because one payment legitimately produces
-- several rows.
create unique index if not exists invoice_tips_provider_payment_member_idx
  on public.invoice_tips (provider, provider_payment_id, membership_id)
  where provider_payment_id is not null and membership_id is not null;

-- The unattributed case can't ride the index above (NULL never equals NULL),
-- so it gets its own single-row-per-payment guard.
create unique index if not exists invoice_tips_provider_payment_unattributed_idx
  on public.invoice_tips (provider, provider_payment_id)
  where provider_payment_id is not null and membership_id is null;

create index if not exists invoice_tips_invoice_idx
  on public.invoice_tips (invoice_id);

-- The payout question: "what's outstanding, by person".
create index if not exists invoice_tips_owed_idx
  on public.invoice_tips (organization_id, membership_id)
  where paid_out_at is null;

comment on table public.invoice_tips is
  'Client tips collected on the public invoice page, one row per beneficiary. The money lands in the org''s Stripe balance (destination charge), so these rows are the record of what the org owes each cleaner. paid_out_at NULL = still owed. membership_id NULL = paid but unattributable.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Read is owner/admin only, matching payroll rather than matching invoices.
-- What each cleaner was tipped is compensation, and the manager capability
-- toggles shipped in 20260819010000 gate the APP, not this table — so the
-- narrow grant is the one that actually holds.
--
-- No insert/update/delete policy for authenticated at all: every write comes
-- from the Stripe webhook via the service role, which bypasses RLS. A tip
-- nobody paid should not be creatable from a browser.

alter table public.invoice_tips enable row level security;

drop policy if exists invoice_tips_select on public.invoice_tips;
create policy invoice_tips_select on public.invoice_tips
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = invoice_tips.organization_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','admin')
      and m.status = 'active'
  ));

-- Marking a tip paid out is an owner/admin action from the app.
drop policy if exists invoice_tips_update on public.invoice_tips;
create policy invoice_tips_update on public.invoice_tips
  for update to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = invoice_tips.organization_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','admin')
      and m.status = 'active'
  ));

notify pgrst, 'reload schema';
