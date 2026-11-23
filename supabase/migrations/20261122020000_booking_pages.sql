-- A company's own booking page: sollos3.com/book/<name>.
--
-- WHY
-- The Sollos site sells to cleaning companies. A company's clients, and
-- people looking for a cleaner, had no page of the company's to land on
-- (docs/online-booking-roadmap.md, phase 1).
--
-- NOW
-- booking_pages holds one page per company. A company has NO page until it
-- makes one in Settings, Online booking: it claims the name, builds the page
-- as a draft, previews it, and publishes it. Nothing is created for anyone
-- by this migration or by signing up.
--
--   slug     the personalised name in the link. Unique across Sollos.
--   status   'draft' (only that company's office can open it) or
--            'published' (anyone with the link).
--
-- Which services show, and how their price shows, live on the service:
--   service_types.show_on_booking_page   off for every service today
--   service_types.booking_page_price     'fixed' | 'from' | 'hidden'
--
-- The public page is read by the server, never by a visitor's own database
-- session, so there is no policy that lets the public read this table.
--
-- Run BEFORE the code push: Settings, Online booking reads these.
-- Idempotent. Changes no existing rows' behaviour.

begin;

create table if not exists public.booking_pages (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Lower-case letters, digits and hyphens; starts and ends with a letter or
  -- digit. The app also refuses a list of reserved words.
  slug            citext not null unique
                    check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  status          text not null default 'draft'
                    check (status in ('draft', 'published')),
  headline        text check (headline is null or length(headline) <= 120),
  intro           text check (intro is null or length(intro) <= 1500),
  published_at    timestamptz,
  created_by      uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists booking_pages_set_updated_at on public.booking_pages;
create trigger booking_pages_set_updated_at
before update on public.booking_pages
for each row execute function public.set_updated_at();

alter table public.booking_pages enable row level security;

-- The office reads its own page (owners, admins and managers).
drop policy if exists "office reads own org booking_pages" on public.booking_pages;
create policy "office reads own org booking_pages"
  on public.booking_pages for select
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
        and role in ('owner', 'admin', 'manager')
    )
  );

-- Owners and admins make and change it, like the rest of Settings.
drop policy if exists "admins manage own org booking_pages" on public.booking_pages;
create policy "admins manage own org booking_pages"
  on public.booking_pages for all
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
        and role in ('owner', 'admin')
    )
  )
  with check (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
        and role in ('owner', 'admin')
    )
  );

alter table public.service_types
  add column if not exists show_on_booking_page boolean not null default false;

alter table public.service_types
  add column if not exists booking_page_price text not null default 'hidden'
    check (booking_page_price in ('fixed', 'from', 'hidden'));

commit;

notify pgrst, 'reload schema';
