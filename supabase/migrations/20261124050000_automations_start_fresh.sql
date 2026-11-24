-- Switching automations on starts fresh.
--
-- WHY
-- The master switch (organizations.automations_enabled) is also how a demo
-- company is paused. Nothing is queued while it is off, but two nightly jobs
-- look BACK for finished visits nobody was asked about: the "how did we do?"
-- request (30 days) and the first Google review ask (14 days). Switched back
-- on after two weeks, those would write to clients about visits from the
-- pause (Brian, 2026-11-24: "That shouldn't happen").
--
-- NOW
-- The moment the switch goes from off to on is recorded, and those two jobs
-- leave alone any visit scheduled before it. The stamp is set by a trigger,
-- so every way of switching on (the button, a preset, SQL) is covered.
--
-- A company that has never switched since this ran has no stamp and behaves
-- exactly as before.
--
-- Run BEFORE the code push: the nightly jobs read the new column.
-- Safe to run more than once. Changes no existing rows.

begin;

alter table public.organizations
  add column if not exists automations_resumed_at timestamptz;
comment on column public.organizations.automations_resumed_at is
  'When automations_enabled last went from off to on. Review requests ignore visits scheduled before this. Null: never switched on since 2026-11-24, so no floor.';

create or replace function public.stamp_automations_resumed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.automations_enabled is true and old.automations_enabled is distinct from true then
    new.automations_resumed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_stamp_automations_resumed on public.organizations;
create trigger organizations_stamp_automations_resumed
before update of automations_enabled on public.organizations
for each row
execute function public.stamp_automations_resumed();

commit;

notify pgrst, 'reload schema';
