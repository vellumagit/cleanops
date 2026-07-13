-- Per-member calendar scope + own-job highlight color.
--
-- A manager who also cleans can set their personal Google Calendar to show the
-- WHOLE org's schedule ('all') instead of just their own jobs ('mine'), with
-- their own shifts highlighted in a color. 'all' is gated to owner/admin/manager
-- in the app (a plain cleaner shouldn't see every client's address).

alter table public.memberships
  add column if not exists calendar_scope text not null default 'mine'
    check (calendar_scope in ('mine', 'all')),
  add column if not exists calendar_color text not null default '6'; -- Google colorId 6 = Tangerine (orange)

comment on column public.memberships.calendar_scope is
  'Personal Google Calendar scope: mine = only assigned jobs; all = every org booking (managers+).';
comment on column public.memberships.calendar_color is
  'Google Calendar colorId used to highlight this member''s OWN jobs when scope = all.';

notify pgrst, 'reload schema';
