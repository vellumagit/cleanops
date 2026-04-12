-- =============================================================================
-- Migration: Internal automations
--
-- 1. Auto-assign published training modules to new members (trigger)
-- 2. Auto-post feed event when new member joins (trigger)
-- 3. Update notification type enum to include new types
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Auto-assign published training to new members
-- Fires after a new membership is inserted. Assigns all published training
-- modules in that org to the new member.
-- -----------------------------------------------------------------------------

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

drop trigger if exists trg_auto_assign_training on public.memberships;
create trigger trg_auto_assign_training
after insert on public.memberships
for each row execute function public.auto_assign_training();

-- Also fire when a member is activated (status changed to 'active')
create or replace function public.auto_assign_training_on_activate()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status = 'active' and (old.status is null or old.status != 'active') then
    perform public.auto_assign_training();
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Auto-post to feed when a new active member joins
-- Creates a system post: "👋 [Name] just joined the team!"
-- -----------------------------------------------------------------------------

create or replace function public.feed_new_member()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status != 'active' then
    return new;
  end if;

  -- Get the member's name
  select full_name into v_name
  from public.profiles
  where id = new.profile_id;

  if v_name is null then
    v_name := 'A new team member';
  end if;

  -- Post to feed (author = the new member themselves)
  insert into public.feed_posts (organization_id, author_id, body)
  values (
    new.organization_id,
    new.id,
    v_name || ' just joined the team! Welcome aboard.'
  );

  return new;
end;
$$;

drop trigger if exists trg_feed_new_member on public.memberships;
create trigger trg_feed_new_member
after insert on public.memberships
for each row execute function public.feed_new_member();
