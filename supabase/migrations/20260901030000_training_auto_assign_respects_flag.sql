-- Make the training auto-assign trigger honor assign_on_join.
--
-- Two competing mechanisms have both been live:
--   * trg_auto_assign_training (20260411060000) — assigns ALL published
--     modules to every new membership, from before the flag existed.
--   * assignOnboardingTraining (app, 20260829040000) — assigns only
--     assign_on_join modules at invite-accept time, which is the
--     documented intent of the flag.
-- The trigger fired first on every insert, so assign_on_join was
-- effectively a no-op and every published module landed on every new
-- hire — inflating the assigned denominators on /app/training.
--
-- Fix at the source: the trigger now respects the flag, so the rule is
-- uniform for memberships created through ANY path (invite accept, the
-- Hire button, manual add). Existing over-assigned rows are left alone —
-- deleting assignments would erase real completion history; unassign by
-- hand from the module page where it matters.
--
-- Also drops auto_assign_training_on_activate(): never bound to a
-- trigger, and its body calls a trigger function directly, which
-- Postgres rejects at runtime — dead weight either way.

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

drop function if exists public.auto_assign_training_on_activate();
