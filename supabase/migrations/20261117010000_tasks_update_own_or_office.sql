-- A cleaner can update only a task that is already theirs.
--
-- WHY
-- The tasks UPDATE policy let ANY active member of the company through its
-- USING clause (which rows may be touched), and only checked the NEW row in
-- WITH CHECK: an employee's edit passed as long as the task ended up
-- assigned to them. So a cleaner could take over any task in the company,
-- and rewrite its title, notes, due date and reminder, simply by assigning
-- it to themselves in the same update (through the edit action, or straight
-- through the API with their own sign-in).
--
-- NOW
-- USING admits the office (owner, admin, manager) for any task in their
-- company, and anyone else only for a task already assigned to them. WITH
-- CHECK is unchanged: the office may save anything in their company; an
-- employee's save must leave the task assigned to them. So a cleaner can
-- still tick off (or reopen) their own task, and can't reach anyone else's.
--
-- The edit action (updateTaskAction) also checks the role now, so this is
-- the backstop for anyone going around the app.
--
-- Safe to run before or after the code push. Idempotent.

begin;

drop policy if exists "tasks: managers+ can update any; employees can complete own" on public.tasks;

create policy "tasks: managers+ can update any; employees can complete own"
  on public.tasks for update
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin', 'manager')
    )
    or assigned_to in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
  with check (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin', 'manager')
    )
    or (
      -- Employee completing their own assigned task only
      assigned_to in (
        select id from public.memberships
        where profile_id = auth.uid() and status = 'active'
      )
    )
  );

commit;
