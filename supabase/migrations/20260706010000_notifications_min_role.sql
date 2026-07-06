-- Role-aware visibility for org-wide (null-recipient) notifications.
--
-- Before this, the "members read own notifications" RLS policy let ANY active
-- member read every recipient_membership_id IS NULL row — no role check. With
-- `force row level security` on, RLS is the sole trust boundary, and cleaners
-- hold an RLS-bound browser session (chat), so a cleaner could run
-- `select * from notifications` and read org-wide management content
-- (financials, reviews, bonuses, referrals). This adds a per-row min_role floor
-- and enforces it in RLS, so a null-recipient management row is invisible to a
-- lower role even if the app layer is wrong.

alter table public.notifications
  add column if not exists min_role public.membership_role not null default 'employee';

-- Rank roles for "caller role >= row's required role" comparisons.
create or replace function public.role_rank(r public.membership_role)
returns int
language sql
immutable
as $$
  select case r
    when 'owner'    then 4
    when 'admin'    then 3
    when 'manager'  then 2
    when 'employee' then 1
    else 0
  end;
$$;

-- Backfill: every EXISTING null-recipient row was management-facing (there were
-- no legitimate org-wide notifications historically), so raise their floor to
-- 'manager' — this hides the historical leak from employees/cleaners while
-- keeping owner/admin/manager access. New rows are stamped correctly by
-- notify() / the triggers below.
update public.notifications
  set min_role = 'manager'
  where recipient_membership_id is null
    and min_role = 'employee';

-- Replace SELECT policy: the null-recipient branch now additionally requires an
-- active membership whose role outranks (>=) the row's min_role. The
-- recipient = self branch is unchanged.
drop policy if exists "members read own notifications" on public.notifications;
create policy "members read own notifications"
on public.notifications for select
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  and (
    (
      recipient_membership_id is null
      and exists (
        select 1 from public.memberships m
        where m.organization_id = notifications.organization_id
          and m.profile_id = auth.uid()
          and m.status = 'active'
          and public.role_rank(m.role) >= public.role_rank(notifications.min_role)
      )
    )
    or recipient_membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

-- Same floor on the UPDATE (mark-read) policy's null-recipient branch.
drop policy if exists "members update own notifications" on public.notifications;
create policy "members update own notifications"
on public.notifications for update
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  and (
    (
      recipient_membership_id is null
      and exists (
        select 1 from public.memberships m
        where m.organization_id = notifications.organization_id
          and m.profile_id = auth.uid()
          and m.status = 'active'
          and public.role_rank(m.role) >= public.role_rank(notifications.min_role)
      )
    )
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

-- DB triggers that still write null-recipient content: stamp min_role so the
-- RLS floor hides them from cleaners. Financial (invoice paid) → admin; ops
-- (low stock) → manager.
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
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    select name into v_client_name
      from public.clients
     where id = new.client_id;

    v_invoice_number := coalesce(new.number, new.id::text);

    insert into public.notifications (
      organization_id, type, title, body, href, min_role
    ) values (
      new.organization_id,
      'review_request',
      'Invoice ' || v_invoice_number || ' paid!',
      coalesce(v_client_name, 'A client') || ' paid invoice ' || v_invoice_number || '. Send them a review request?',
      '/app/invoices/' || new.id,
      'admin'
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_low_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reorder_threshold > 0
     and new.quantity <= new.reorder_threshold
     and (old.quantity > old.reorder_threshold or old.quantity is null)
  then
    insert into public.notifications (
      organization_id, type, title, body, href, min_role
    ) values (
      new.organization_id,
      'low_inventory',
      'Low stock: ' || new.name,
      new.name || ' is at ' || new.quantity || ' units (reorder threshold: ' || new.reorder_threshold || ').',
      '/app/inventory',
      'manager'
    );
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
