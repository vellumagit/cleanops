-- Backfill: orgs actively using the feed keep it visible after the
-- feed_visible-default-off rollout.
--
-- The c0ea0ff commit gated the feed feature on a new automation toggle
-- (`feed_visible`) which DEFAULT_OFF — fine for new orgs, but any
-- existing org that's been actively posting to /app/feed or /field/feed
-- would silently lose their sidebar link + see 404s on bookmarked URLs
-- the moment that commit deploys.
--
-- This migration detects "actively using" via at least one feed_posts
-- row created in the last 30 days, and pre-populates
-- `organizations.automation_settings.feed_visible.enabled = true` so
-- the default-OFF resolver in lib/automation-defaults.ts treats them
-- as explicitly opted-in.
--
-- Orgs with NO recent feed activity stay at the default (off). They
-- can flip it on themselves at Settings → Automations → Show team feed.
--
-- Idempotent: skips orgs that already have an explicit setting
-- (whether true or false — respects an explicit opt-OUT just as much
-- as an opt-IN).

UPDATE public.organizations o
SET automation_settings =
  COALESCE(automation_settings, '{}'::jsonb)
  || jsonb_build_object(
       'feed_visible',
       jsonb_build_object('enabled', true)
     )
WHERE EXISTS (
  SELECT 1
  FROM public.feed_posts fp
  WHERE fp.organization_id = o.id
    AND fp.created_at >= now() - interval '30 days'
)
AND (
  -- Only set when there's no explicit setting yet. Don't override an
  -- owner who has already deliberately toggled (in either direction).
  automation_settings IS NULL
  OR NOT (automation_settings ? 'feed_visible')
);
