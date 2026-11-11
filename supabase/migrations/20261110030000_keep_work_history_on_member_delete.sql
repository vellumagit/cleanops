-- =============================================================================
-- Removing a person no longer deletes the hours they worked
-- =============================================================================
-- The Delete employee and Force remove confirmations both say "Bookings and
-- timesheets they appear in will be preserved". The schema did the opposite:
-- time_entries.employee_id and bonuses.employee_id were ON DELETE CASCADE, so
-- deleting a membership deleted every shift and bonus that person ever had.
-- The only thing that stopped it was a payroll run that happened to reference
-- them (payroll_items is RESTRICT).
--
-- The same cascade starts one level up. memberships.profile_id cascades from
-- profiles, which cascades from auth.users, so deleting a login in the
-- Supabase dashboard removed the membership and, through it, the shifts.
--
-- Shifts are what payroll, invoices and job history are computed from. They
-- now outlive any attempt to remove the person: the delete is refused with
-- 23503 and the person stays deactivated instead, which is what the app
-- already tells the owner to do for anyone with payroll history.
--
-- NO ACTION, not RESTRICT, so that closing a whole company still works: that
-- deletes the company's shifts in the same statement, and NO ACTION is
-- checked after the statement where RESTRICT is checked before.
--
-- Found by test/db/refusals.test.ts on 2026-11-10. Production's audit log
-- shows no real member was ever deleted this way (four withdrawn
-- invitations, one test member), so nothing was lost.
--
-- Safe to run before or after the push; the app also checks for history
-- before it deletes. Re-runnable. Each ADD validates existing rows, which
-- all have a membership today.
-- =============================================================================

alter table public.time_entries
  drop constraint if exists time_entries_employee_id_fkey;
alter table public.time_entries
  add constraint time_entries_employee_id_fkey
  foreign key (employee_id) references public.memberships(id) on delete no action;

alter table public.bonuses
  drop constraint if exists bonuses_employee_id_fkey;
alter table public.bonuses
  add constraint bonuses_employee_id_fkey
  foreign key (employee_id) references public.memberships(id) on delete no action;
