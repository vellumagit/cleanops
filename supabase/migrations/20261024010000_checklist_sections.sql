-- Checklists get real sections.
--
-- A checklist was a flat list, so Svitlana built sections by typing
-- ALL-CAPS rows ("KITCHEN", "BATHROOMS"). Cleaners then got those headings
-- as tick boxes, and they padded "12/40 complete" with rows nobody can do.
-- Her detailed deep-clean list has rooms AND groups within rooms (KITCHEN →
-- Appliances → "Clean inside and outside of microwave"), which a flat list
-- can't show at all.
--
-- `kind` on both the template rows and the per-job copies:
--   item        a task to tick (everything that exists today)
--   section     a room / area heading
--   subsection  a group within a section
-- Headings are never ticked and never counted.

alter table public.checklist_template_items
  add column if not exists kind text not null default 'item'
    check (kind in ('item', 'section', 'subsection'));

alter table public.booking_checklist_items
  add column if not exists kind text not null default 'item'
    check (kind in ('item', 'section', 'subsection'));

-- The headings that already exist: ALL-CAPS rows of five words or fewer.
-- On 2026-10-24 that is exactly 15 rows in Svit's three main checklists, all
-- room names (LIVING AREAS & BEDROOMS, KITCHEN, BATHROOMS, HALLWAYS & STAIRS,
-- EXTRA TOUCHES). Their copies on jobs follow, so today's phones match.
update public.checklist_template_items
   set kind = 'section'
 where kind = 'item'
   and title ~ '[A-Z]'
   and title !~ '[a-z]'
   and title !~ '!'
   and array_length(regexp_split_to_array(trim(title), '\s+'), 1) <= 5;

update public.booking_checklist_items
   set kind = 'section', checked_at = null, checked_by = null
 where kind = 'item'
   and title ~ '[A-Z]'
   and title !~ '[a-z]'
   and title !~ '!'
   and array_length(regexp_split_to_array(trim(title), '\s+'), 1) <= 5;

-- ── Every path that copies a template onto a job now carries `kind` ────────
-- Bodies unchanged apart from the column; see 20260708010000 and
-- 20260826010000 for the reasoning behind each.

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
      (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required, kind)
    select new.organization_id, new.id, ti.template_id, ti.ordinal, ti.title, ti.phase, ti.is_required, ti.kind
      from public.checklist_template_items ti
     where ti.template_id = v_template
     order by ti.ordinal;
  end if;

  return new;
end;
$$;

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
    (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required, kind)
  select b.organization_id, b.id, ti.template_id, ti.ordinal, ti.title, ti.phase, ti.is_required, ti.kind
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
    (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required, kind)
  select new.organization_id,
         new.id,
         ti.template_id,
         coalesce((select max(x.ordinal) + 1
                     from public.booking_checklist_items x
                    where x.booking_id = new.id), 0)
           + row_number() over (order by t.name, ti.ordinal) - 1,
         ti.title,
         ti.phase,
         ti.is_required,
         ti.kind
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
    (organization_id, booking_id, source_template_id, ordinal, title, phase, is_required, kind)
  select b.organization_id,
         b.id,
         ti.template_id,
         coalesce((select max(x.ordinal) + 1
                     from public.booking_checklist_items x
                    where x.booking_id = b.id), 0) + ti.ordinal,
         ti.title,
         ti.phase,
         ti.is_required,
         ti.kind
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

-- Replacing a function keeps its grants, but restate the lock from
-- 20260827010000 so it can't silently regress.
revoke execute on function public.backfill_client_checklist(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.backfill_client_checklist(uuid, uuid)
  to service_role;
revoke execute on function public.backfill_service_checklist(uuid)
  from public, anon, authenticated;
grant execute on function public.backfill_service_checklist(uuid)
  to service_role;

notify pgrst, 'reload schema';
