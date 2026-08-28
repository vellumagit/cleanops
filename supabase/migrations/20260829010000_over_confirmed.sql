-- "Looks good" for over-allotted shifts.
--
-- The orange "+2m / +1h" tag is DERIVED (entry duration vs the job's
-- allotted time) with no column behind it — so nothing could ever clear
-- it. Brian: "I have to go into edit and then save changes, and that
-- doesn't really do shit ... there should be a button right on there
-- being like looks good or approved, so it goes back to default."
--
-- A human's sign-off gets a home: set by the row's Confirm button AND by
-- any edit-save of the entry (touching the hours is reviewing them). The
-- display gates on it, so chip, row tint, banner count, and the flagged
-- filter all clear together.

alter table public.time_entries
  add column if not exists over_confirmed_at timestamptz,
  add column if not exists over_confirmed_by uuid
    references public.memberships(id) on delete set null;

comment on column public.time_entries.over_confirmed_at is
  'A human confirmed this over-allotted shift is right; the +time flag stops showing. NULL = not yet reviewed (only meaningful when the entry ran past its allotted minutes).';

notify pgrst, 'reload schema';
