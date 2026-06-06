-- =============================================================================
-- email_suppressions — addresses we should never send to again
-- =============================================================================
--
-- Populated by Resend webhooks for email.bounced and email.complained events.
-- Checked at send time in sendEmailDetailed so we never throw a bouncing or
-- complaining address back into Resend, which would gradually destroy sender
-- reputation for every org sharing our verified domain.
--
-- Platform-wide (not org-scoped) because Resend reputation is account-wide:
-- if org A's address bounces and org B sends to the same address from the
-- same Resend account, the deliverability hit lands on both. So we block
-- everywhere.
--
-- Service-role-only writes (the webhook handler uses the admin client).
-- No end-user reads — owners get a future bounces dashboard that proxies
-- this data through a server action, not direct SELECT.
-- =============================================================================

create table if not exists public.email_suppressions (
  id                  uuid primary key default gen_random_uuid(),
  -- The email address as Resend reports it. Lowercased + trimmed at insert
  -- time so the lookup at send is case-insensitive.
  email               text not null,
  -- Why we suppressed: 'bounced' (delivery failed permanently), 'complained'
  -- (recipient marked as spam), 'manual' (admin added). Could later add
  -- 'soft_bounce' with a TTL for mailbox-full type cases.
  reason              text not null check (reason in ('bounced', 'complained', 'manual')),
  -- Resend's event id from the webhook — idempotency key so a redelivered
  -- webhook doesn't insert a duplicate row.
  provider_event_id   text,
  -- The raw event payload from Resend, for debugging "why was this
  -- suppressed?" months later without having to hit Resend's logs.
  event_payload       jsonb,
  created_at          timestamptz not null default now()
);

-- One row per address — upserts on conflict. If a previously-bounced address
-- later complains too, we just update the existing row's reason (whichever
-- the latest event was) without duplicating.
create unique index if not exists email_suppressions_email_uidx
  on public.email_suppressions (lower(email));

-- Idempotency: a redelivered webhook with the same event id is a no-op.
create unique index if not exists email_suppressions_event_uidx
  on public.email_suppressions (provider_event_id)
  where provider_event_id is not null;

-- RLS: service-role only. End users never read or write this table directly.
alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;
-- No policies = no access for anon/authenticated. Service role bypasses RLS.
