-- Accommodations & health notes for a team member (allergies/sensitivities,
-- accessibility needs, medical considerations). Lives in the admin-only
-- membership_admin_data table alongside notes/address, so it's never exposed
-- to the employee via the blanket memberships SELECT policy.
alter table public.membership_admin_data
  add column if not exists accommodations text;
