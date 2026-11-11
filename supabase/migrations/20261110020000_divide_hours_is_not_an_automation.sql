-- =============================================================================
-- "Divide crew hours" is a scheduling preference, not an automation
-- =============================================================================
-- One question, "does this company divide a team job's hours across its
-- crew?", had two answers. Every reader in the app (pay, the field app, the
-- calendar, the job rules, booking warnings) reads the company's
-- divide_crew_hours setting on its own. booking_shares_hours, which the
-- overlap guard uses, also required the master "automations" switch to be on.
--
-- So with automations paused and the preference on, the app showed a two-
-- person, four-hour job as two hours each, and the overlap guard measured it
-- as four: it refused schedules the booking form had just called fine.
--
-- Pausing automations stops messages and background work. It was never meant
-- to change how long a job is. The guard now reads the preference the way
-- everything else does. Found by test/db/twins.test.ts, which holds the SQL
-- and TypeScript versions of this rule to the same answer.
--
-- No company is in the affected state today (Svit has both on). Safe to run
-- before or after the push. create or replace keeps the function's grants.
-- =============================================================================

create or replace function public.booking_shares_hours(
  p_divide_hours_evenly boolean,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_divide_hours_evenly, false) or exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and (o.automation_settings -> 'divide_crew_hours' ->> 'enabled') = 'true'
  );
$$;
