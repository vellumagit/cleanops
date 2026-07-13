-- Client-level default cleaning checklist.
--
-- Assign a checklist template to a client, and every booking for that client
-- automatically gets the template's items (which cleaners then check off in the
-- field app). A DB trigger handles the auto-attach so EVERY creation path is
-- covered — manual create, recurring series, cron-generated occurrences, and
-- imports — without hooking each one in app code.

alter table public.clients
  add column if not exists default_checklist_template_id uuid
    references public.checklist_templates(id) on delete set null;

create index if not exists clients_default_checklist_idx
  on public.clients (default_checklist_template_id)
  where default_checklist_template_id is not null;

-- ── Auto-attach on booking insert ───────────────────────────────────────────
create or replace function public.apply_client_checklist_on_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
begin
  if new.client_id is null then
    return new;
  end if;

  select default_checklist_template_id into v_template
    from public.clients
   where id = new.client_id;

  if v_template is not null then
    insert into public.booking_checklist_items
      (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required)
    select new.organization_id, new.id, ti.template_id, ti.ordinal, ti.title, ti.phase, ti.is_required
      from public.checklist_template_items ti
     where ti.template_id = v_template
     order by ti.ordinal;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_client_checklist_after_booking_insert on public.bookings;
create trigger apply_client_checklist_after_booking_insert
  after insert on public.bookings
  for each row execute function public.apply_client_checklist_on_booking();

-- ── Backfill helper (for already-scheduled bookings when you assign) ─────────
-- Applies a template to a client's UPCOMING, non-cancelled bookings that don't
-- already have a checklist. Idempotent via the NOT EXISTS guard, so re-running
-- (or a client that already has some items) never double-adds.
create or replace function public.backfill_client_checklist(
  p_client uuid,
  p_template uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.booking_checklist_items
    (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required)
  select b.organization_id, b.id, ti.template_id, ti.ordinal, ti.title, ti.phase, ti.is_required
    from public.bookings b
    join public.checklist_template_items ti on ti.template_id = p_template
   where b.client_id = p_client
     and b.scheduled_at >= now()
     and b.status <> 'cancelled'
     and not exists (
       select 1 from public.booking_checklist_items x where x.booking_id = b.id
     )
   order by b.id, ti.ordinal;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

notify pgrst, 'reload schema';
