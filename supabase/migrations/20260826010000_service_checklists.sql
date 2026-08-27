-- Service-level default checklists — the missing sibling of the client one.
--
-- checklist_templates has carried `applies_to_service_type` (a legacy enum
-- text) since April, and the UI even printed "auto-applies to deep clean" —
-- but NO code ever read it. The label described behavior that didn't exist.
--
-- This makes it real, pointed at the org's actual service catalog
-- (service_types rows, not the hardcoded enum). Same proven pattern as
-- clients.default_checklist_template_id (20260708010000): a DB trigger on
-- booking insert so EVERY creation path is covered — manual create,
-- recurring series, cron-generated occurrences — plus a backfill helper
-- for bookings already on the calendar (occurrences are generated up to a
-- year ahead; without backfill a new service checklist wouldn't appear on
-- any recurring job for months).
--
-- The legacy text column is left in place but ignored. It is deliberately
-- NOT migrated into the new FK: 28 of Svit's templates say "standard" only
-- because that was the editor's default — they're per-client checklists,
-- and converting the stale tag into live behavior would spray one client's
-- checklist across every standard booking in the org. Owners opt in per
-- template.

alter table public.checklist_templates
  add column if not exists applies_to_service_type_id uuid
    references public.service_types(id) on delete set null;

create index if not exists checklist_templates_service_idx
  on public.checklist_templates (organization_id, applies_to_service_type_id)
  where applies_to_service_type_id is not null;

-- ── Auto-attach on booking insert ───────────────────────────────────────────
-- Fires AFTER the client-default trigger (same event; PostgreSQL runs same-
-- event triggers alphabetically, and apply_client_… < apply_service_…), so a
-- client's own checklist keeps the first ordinals and the per-template
-- NOT EXISTS guard prevents double-adding when the client default IS one of
-- the service templates.
create or replace function public.apply_service_checklist_on_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.service_type_id is null then
    return new;
  end if;

  insert into public.booking_checklist_items
    (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required)
  select new.organization_id,
         new.id,
         ti.template_id,
         coalesce((select max(x.ordinal) + 1
                     from public.booking_checklist_items x
                    where x.booking_id = new.id), 0)
           + row_number() over (order by t.name, ti.ordinal) - 1,
         ti.title,
         ti.phase,
         ti.is_required
    from public.checklist_templates t
    join public.checklist_template_items ti on ti.template_id = t.id
   where t.organization_id = new.organization_id
     and t.applies_to_service_type_id = new.service_type_id
     and t.is_active
     and not exists (
       select 1 from public.booking_checklist_items x
        where x.booking_id = new.id
          and x.source_template_id = t.id
     );

  return new;
end;
$$;

drop trigger if exists apply_service_checklist_after_booking_insert on public.bookings;
create trigger apply_service_checklist_after_booking_insert
  after insert on public.bookings
  for each row execute function public.apply_service_checklist_on_booking();

-- ── Backfill helper ─────────────────────────────────────────────────────────
-- Applies a template to UPCOMING, non-cancelled bookings of its service that
-- don't already carry this template. Guard is per-template (not "has any
-- checklist") so a service checklist composes with an already-attached
-- client checklist instead of being blocked by it. Idempotent.
create or replace function public.backfill_service_checklist(
  p_template uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_service uuid;
  v_count integer;
begin
  select organization_id, applies_to_service_type_id
    into v_org, v_service
    from public.checklist_templates
   where id = p_template;

  if v_service is null then
    return 0;
  end if;

  insert into public.booking_checklist_items
    (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required)
  select b.organization_id,
         b.id,
         ti.template_id,
         coalesce((select max(x.ordinal) + 1
                     from public.booking_checklist_items x
                    where x.booking_id = b.id), 0) + ti.ordinal,
         ti.title,
         ti.phase,
         ti.is_required
    from public.bookings b
    join public.checklist_template_items ti on ti.template_id = p_template
   where b.organization_id = v_org
     and b.service_type_id = v_service
     and b.scheduled_at >= now()
     and b.status <> 'cancelled'
     and not exists (
       select 1 from public.booking_checklist_items x
        where x.booking_id = b.id
          and x.source_template_id = p_template
     )
   order by b.id, ti.ordinal;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

notify pgrst, 'reload schema';
