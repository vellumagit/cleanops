-- =============================================================================
-- Product changelog — the weekly "what's new in Sollos" email to org owners
-- =============================================================================
-- Entries are PLATFORM-level (Sollos's own release notes), not tenant data, so
-- there's no organization_id. They're written by hand: customer-facing copy has
-- to be human-curated. Auto-blasting commit subjects ("Fix: card detector
-- silently rejected notes") would confuse or alarm customers.
--
-- The weekly cron emails every entry that is published but not yet sent, then
-- stamps sent_at. A quiet week has no unsent entries → no email goes out, which
-- is the "only when big changes are made" behaviour.
--
-- Recipients are org OWNERS of orgs that opted in (automation key
-- product_changelog_email, default off like every automation). Per-recipient
-- one-click unsubscribe uses membership-level tokens below.
-- =============================================================================

create table if not exists public.changelog_entries (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  -- Short customer-facing summary. Plain text or light HTML; rendered into the
  -- email template as a list item.
  body         text not null,
  -- Null = draft (never sent). Set when it's ready to go out.
  published_at timestamptz,
  -- Stamped by the cron once the entry has been mailed. Non-null = never resend.
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists changelog_entries_sendable_idx
  on public.changelog_entries (published_at)
  where published_at is not null and sent_at is null;

-- RLS: platform-owned content. No tenant reads it directly through PostgREST —
-- the cron uses the service-role key, which bypasses RLS. Default-deny.
alter table public.changelog_entries enable row level security;
alter table public.changelog_entries force row level security;

comment on table public.changelog_entries is
  'Sollos product release notes. Written by hand; mailed weekly to opted-in org owners by /api/cron/product-changelog.';

-- ---------------------------------------------------------------------------
-- Per-recipient unsubscribe
-- ---------------------------------------------------------------------------
-- RFC 8058 one-click unsubscribe needs a per-recipient token. An owner opting
-- out here must NOT disable the whole org's automation for everyone else, so
-- this is membership-level.

alter table public.memberships
  add column if not exists product_updates_unsubscribed_at timestamptz,
  add column if not exists product_updates_unsub_token text;

create unique index if not exists memberships_product_unsub_token_idx
  on public.memberships (product_updates_unsub_token)
  where product_updates_unsub_token is not null;

comment on column public.memberships.product_updates_unsubscribed_at is
  'When set, this member has opted out of the Sollos product-changelog email (one-click unsubscribe). Independent of the org automation toggle.';
