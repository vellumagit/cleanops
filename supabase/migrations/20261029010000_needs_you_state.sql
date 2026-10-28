-- The "Needs you" list (src/lib/needs-you.ts) is computed, not stored: every
-- item is a question the jobs themselves pose right now. Two things about
-- an item do have to be remembered, though — that a manager answered
-- "still coming" or "still working" (snooze it until the window ends), and
-- that the alert for it already went out (never twice).

CREATE TABLE IF NOT EXISTS public.needs_you_state (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  key             text NOT NULL,
  snoozed_until   timestamptz,
  snoozed_by      uuid REFERENCES public.memberships (id) ON DELETE SET NULL,
  notified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);

COMMENT ON TABLE public.needs_you_state IS
  'Per-item memory for the dashboard "Needs you" list: snoozes and sent alerts, keyed by the item''s stable key.';

ALTER TABLE public.needs_you_state ENABLE ROW LEVEL SECURITY;

-- Managers answer items; the cron (service role) records alerts.
CREATE POLICY "managers_manage_needs_you_state"
  ON public.needs_you_state FOR ALL
  USING (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
  WITH CHECK (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- Rows go stale once the job is days past; nothing reads them after that.
CREATE INDEX IF NOT EXISTS needs_you_state_created_idx
  ON public.needs_you_state (created_at);
