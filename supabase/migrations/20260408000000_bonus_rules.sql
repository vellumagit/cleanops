-- =============================================================================
-- CleanOps Phase 7 — Bonus rule engine
-- =============================================================================
-- Adds a single per-organization configuration row that drives the bonus
-- compute job. Kept in its own table (instead of bloating `organizations`)
-- so we can iterate the rule shape without touching the tenancy spine.
--
-- The rule is intentionally tiny:
--   "If an employee's average rating across the last `period_days` days
--    is at least `min_avg_rating` AND they have at least `min_reviews_count`
--    reviews in that window, award `amount_cents`."
--
-- Cron wiring lives in Phase 10 — for now the compute action is invoked
-- by an admin from the bonuses page.
-- =============================================================================

create table if not exists public.bonus_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null unique references public.organizations(id) on delete cascade,
  enabled             boolean not null default false,
  min_avg_rating      numeric(3,2) not null default 4.80 check (min_avg_rating between 1 and 5),
  min_reviews_count   integer not null default 5 check (min_reviews_count >= 1),
  period_days         integer not null default 30 check (period_days between 1 and 365),
  amount_cents        integer not null default 5000 check (amount_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists bonus_rules_organization_id_idx
  on public.bonus_rules (organization_id);

drop trigger if exists bonus_rules_set_updated_at on public.bonus_rules;
create trigger bonus_rules_set_updated_at
before update on public.bonus_rules
for each row execute function public.set_updated_at();

alter table public.bonus_rules enable row level security;
alter table public.bonus_rules force row level security;

drop policy if exists "members read bonus_rules" on public.bonus_rules;
create policy "members read bonus_rules"
on public.bonus_rules for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert bonus_rules" on public.bonus_rules;
create policy "admins insert bonus_rules"
on public.bonus_rules for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update bonus_rules" on public.bonus_rules;
create policy "admins update bonus_rules"
on public.bonus_rules for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete bonus_rules" on public.bonus_rules;
create policy "admins delete bonus_rules"
on public.bonus_rules for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

comment on table public.bonus_rules is
  'Per-organization configuration for the review-driven bonus engine.';

-- -----------------------------------------------------------------------------
-- reviews — allow authenticated org admins to INSERT
-- -----------------------------------------------------------------------------
-- The Phase 2 RLS only allowed delete/select for reviews because the original
-- design was service-role-only inserts (clients submitting via tokenized link).
-- Phase 7 adds an admin-side "Add review" flow inside the ops console so
-- managers can record verbal feedback. The tokenized public flow can be added
-- later without removing this policy.

drop policy if exists "admins insert reviews" on public.reviews;
create policy "admins insert reviews"
on public.reviews for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));
