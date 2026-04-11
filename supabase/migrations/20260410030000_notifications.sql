-- -----------------------------------------------------------------------------
-- In-app notification system
--
-- Three automations powered by this table:
--   1. Review request after invoice is paid
--   2. Low inventory alert when quantity <= reorder_threshold
--   3. Unfilled shift alert (handled by cron, not a trigger)
--
-- Notifications belong to an org and optionally target a specific membership.
-- If recipient_membership_id is null, the notification is org-wide (all
-- owners/admins see it).
-- -----------------------------------------------------------------------------

-- Enum for notification types
create type public.notification_type as enum (
  'review_request',
  'low_inventory',
  'unfilled_shift',
  'general'
);

-- Main notifications table
create table if not exists public.notifications (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  recipient_membership_id uuid references public.memberships(id) on delete cascade,
  type                    public.notification_type not null default 'general',
  title                   text not null,
  body                    text,
  href                    text,
  read_at                 timestamptz,
  created_at              timestamptz not null default now()
);

create index notifications_org_recipient_idx
  on public.notifications (organization_id, recipient_membership_id, read_at);
create index notifications_created_at_idx
  on public.notifications (created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Members can read notifications for their org that are either targeted to
-- them or org-wide (recipient is null).
create policy "members read own notifications"
on public.notifications for select
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  and (
    recipient_membership_id is null
    or recipient_membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

-- Members can update (mark read) their own notifications.
create policy "members update own notifications"
on public.notifications for update
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  and (
    recipient_membership_id is null
    or recipient_membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
)
with check (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- Only service role (triggers/crons) inserts notifications.
-- No user-facing insert policy — triggers run as SECURITY DEFINER.

-- Admins can delete notifications for their org.
create policy "admins delete notifications"
on public.notifications for delete
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin')
  )
);

-- -----------------------------------------------------------------------------
-- Automation #1: Review request after invoice is paid
--
-- When sync_invoice_payment_totals sets status = 'paid', fire a notification
-- to the org owners/admins with a link to send a review request.
-- We create a separate trigger on invoices (not invoice_payments) because
-- the status update happens in sync_invoice_payment_totals.
-- -----------------------------------------------------------------------------

create or replace function public.notify_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_name text;
  v_invoice_number text;
begin
  -- Only fire when status transitions to 'paid'
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    select name into v_client_name
      from public.clients
     where id = new.client_id;

    v_invoice_number := coalesce(new.number, new.id::text);

    insert into public.notifications (
      organization_id, type, title, body, href
    ) values (
      new.organization_id,
      'review_request',
      'Invoice ' || v_invoice_number || ' paid!',
      coalesce(v_client_name, 'A client') || ' paid invoice ' || v_invoice_number || '. Send them a review request?',
      '/app/invoices/' || new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_invoice_paid on public.invoices;
create trigger trg_notify_invoice_paid
  after update on public.invoices
  for each row
  execute function public.notify_invoice_paid();

-- -----------------------------------------------------------------------------
-- Automation #2: Low inventory alert
--
-- When an inventory item's quantity drops to or below reorder_threshold,
-- notify the org. We only fire when crossing the threshold (was above, now
-- at or below) to avoid spamming on repeated edits.
-- -----------------------------------------------------------------------------

create or replace function public.notify_low_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only fire when crossing the threshold downward
  if new.reorder_threshold > 0
     and new.quantity <= new.reorder_threshold
     and (old.quantity > old.reorder_threshold or old.quantity is null)
  then
    insert into public.notifications (
      organization_id, type, title, body, href
    ) values (
      new.organization_id,
      'low_inventory',
      'Low stock: ' || new.name,
      new.name || ' is at ' || new.quantity || ' units (reorder threshold: ' || new.reorder_threshold || ').',
      '/app/inventory'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_low_inventory on public.inventory_items;
create trigger trg_notify_low_inventory
  after update on public.inventory_items
  for each row
  execute function public.notify_low_inventory();

-- -----------------------------------------------------------------------------
-- Add review_token to invoices for public review links
-- -----------------------------------------------------------------------------

alter table public.invoices
  add column if not exists review_token text unique;

comment on column public.invoices.review_token
  is 'Random token for the public post-payment review page. Generated when invoice is paid.';

comment on table public.notifications is 'In-app notifications for automations and alerts.';
