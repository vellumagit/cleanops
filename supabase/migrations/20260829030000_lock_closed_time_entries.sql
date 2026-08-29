-- Employees could rewrite their own CLOSED, even PAYROLL-STAMPED entries.
--
-- The policy "employees update own open time_entries or admins all" said
-- "open" in its name but never checked it: any employee-role member could
-- PATCH /rest/v1/time_entries on their own closed row and change
-- clock_out_at, needs_review, or over_confirmed_at directly — bypassing
-- every application-level freeze guard (which live only in server actions).
-- A cleaner could stretch a paid shift after the run froze it, and the run
-- total would silently stop reconciling with the rows.
--
-- The fix makes the name true. Employees may update their own row only
-- while it is OPEN (no clock_out_at) and UNCLAIMED by either pay system —
-- exactly what the field app's clock-out needs (it sets clock_out_at ON an
-- open row, which passes USING before the write). Closed or stamped rows
-- become staff-only. WITH CHECK additionally stops an employee from
-- stamping their own row into a run (payroll_run_id / subcontractor_run_id
-- must remain NULL on anything they write).

drop policy if exists "employees update own open time_entries or admins all" on public.time_entries;
create policy "employees update own open time_entries or admins all"
on public.time_entries for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or (
    employee_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
    and clock_out_at is null
    and payroll_run_id is null
    and subcontractor_run_id is null
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or (
    employee_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
    and payroll_run_id is null
    and subcontractor_run_id is null
  )
);
