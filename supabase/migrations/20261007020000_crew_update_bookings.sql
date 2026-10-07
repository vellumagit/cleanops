-- Any crew member can update their own job — not just whoever is in
-- bookings.assigned_to — and managers get back the update rights they lost.
--
-- WHY
-- The update policy let owners/admins through, plus the ONE member named in
-- bookings.assigned_to. Everyone else on the crew matched zero rows, and
-- Postgres reports a zero-row update as success, so the app was told it had
-- worked when it hadn't:
--   * startJobAction flips the booking to in_progress with the cleaner's own
--     permissions. When the first person to clock in wasn't the listed lead,
--     the job stayed "confirmed" while she was on the clock.
--   * completeJobAction hit the same thing and was moved to the service-role
--     client as a workaround (see its comment); startJob never was.
--
-- MANAGERS
-- 20260411030001_manager_rls granted owner/admin/MANAGER. The archive-
-- immutability migration (20260502010000) recreated this policy from the
-- older owner/admin text and dropped managers without saying so. Since then a
-- manager could only update bookings she was the lead on; every other booking
-- edit through her own session silently changed nothing. The Sep 13 column
-- guard (bookings_assignee_column_guard) already treats managers as trusted,
-- so restoring them makes the policy agree with it again.
--
-- WHAT A CREW MEMBER CAN CHANGE
-- Unchanged, and deliberately not this migration's job:
-- bookings_assignee_column_guard (20260913030000) refuses any column but
-- status, notes and updated_at for anyone below manager. Widening WHO may
-- update does not widen WHAT they may update.

-- Is the signed-in user on this booking's crew?
-- SECURITY DEFINER so the lookups don't re-enter bookings/booking_assignees
-- RLS (the bookings policy calls this). Checks the crew list, plus the legacy
-- assigned_to column so nothing that relied on it loses access mid-transition.
-- Only ACTIVE memberships count: a deactivated cleaner left on an old job
-- must not keep write access to it.
create or replace function public.is_booking_crew(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
           from public.booking_assignees ba
           join public.memberships m on m.id = ba.membership_id
           where ba.booking_id = p_booking_id
             and m.profile_id = auth.uid()
             and m.status = 'active'
         )
      or exists (
           select 1
           from public.bookings b
           join public.memberships m on m.id = b.assigned_to
           where b.id = p_booking_id
             and m.profile_id = auth.uid()
             and m.status = 'active'
         );
$$;

revoke all on function public.is_booking_crew(uuid) from public;
grant execute on function public.is_booking_crew(uuid) to authenticated;

drop policy if exists "admins or assignee update bookings" on public.bookings;
drop policy if exists "managers or crew update bookings" on public.bookings;

create policy "managers or crew update bookings"
on public.bookings for update
to authenticated
using (
  public.current_user_has_role(
    organization_id,
    array['owner','admin','manager']::public.membership_role[]
  )
  or public.is_booking_crew(id)
)
with check (
  -- Kept from 20260502010000: archived rows are immutable to signed-in users.
  archived_at is null
  and (
    public.current_user_has_role(
      organization_id,
      array['owner','admin','manager']::public.membership_role[]
    )
    or public.is_booking_crew(id)
  )
);
