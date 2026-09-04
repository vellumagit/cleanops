-- ============================================================
-- Training steps can point at something — a video, a doc, a page
-- ============================================================
--
-- A step had text and one reference image. Brian, 2026-09-04: "can we
-- attach links to training in case it's a video or something?" A link
-- per step: YouTube/Vimeo embed inline in the field app, anything else
-- opens in a new tab. Stored as text, validated as http(s) in the action.

alter table public.training_steps
  add column if not exists link_url text
  check (link_url is null or length(link_url) <= 2000);

comment on column public.training_steps.link_url is
  'Optional http(s) link for the step — a training video, a supplier doc, a page. The field app embeds YouTube/Vimeo and links out for everything else.';

notify pgrst, 'reload schema';
