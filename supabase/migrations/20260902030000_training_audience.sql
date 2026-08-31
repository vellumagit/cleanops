-- Training modules learn who they're FOR.
--
-- Brian (Sep 1): a module is assigned to account levels, combinatory —
-- employees/contractors always get their modules, managers only get
-- theirs, any combination addable and removable. audience_roles is that
-- set. Default '{employee}' matches every existing module's reality:
-- the library is cleaner training, and managers were only ever swept in
-- by the old assign-everything trigger.
--
-- The auto-assign trigger (already narrowed to assign_on_join in
-- 20260901030000) now also respects the audience: a new manager gets
-- manager modules, not the bathroom SOP.

alter table public.training_modules
  add column if not exists audience_roles public.membership_role[]
    not null default '{employee}'::public.membership_role[];

comment on column public.training_modules.audience_roles is
  'Account levels this module applies to (combinatory). Auto-assign and the admin surfaces filter by it; existing manual assignments are never touched.';

create or replace function public.auto_assign_training()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_module record;
begin
  -- Only assign to active members
  if new.status != 'active' then
    return new;
  end if;

  for v_module in
    select id from public.training_modules
    where organization_id = new.organization_id
      and status = 'published'
      and assign_on_join
      and new.role = any(audience_roles)
  loop
    insert into public.training_assignments (
      organization_id, employee_id, module_id, completed_step_ids
    ) values (
      new.organization_id, new.id, v_module.id, '{}'::uuid[]
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

notify pgrst, 'reload schema';
