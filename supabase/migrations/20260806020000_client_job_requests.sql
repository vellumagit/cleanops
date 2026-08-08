-- Things a portal client says about a booking they already have: a note for
-- one visit, or a request to skip one.
--
-- Modelled column-for-column on public.shift_change_requests
-- (20260613030000), which is the CREW asking for structurally identical
-- things, rather than inventing a second vocabulary for the same idea.
--
-- WHY NOT bookings.notes.
-- updateBookingAction writes `notes: parsed.data.notes ?? null` unconditionally
-- (bookings/actions.ts:1192) from a snapshot taken when the edit page rendered,
-- so any ordinary owner save silently wipes appended client text. Worse: with
-- update_scope='this_and_future' the same value is promoted into
-- propagatableFields (actions.ts:1284) and becomes the SERIES' standing note,
-- which the nightly extend cron then stamps onto every future occurrence as
-- '[Recurring] ' || series.notes. "Skip the bathroom this week" would become a
-- permanent instruction. With 95% of this org's bookings being series
-- occurrences, that is the common path, not an edge case.
--
-- WHY NOT A NEW COLUMN ON bookings.
-- Two owner paths DELETE the row rather than update it, and both target
-- precisely the future occurrences where client text would live:
--   * skipBookingOccurrenceAction (actions.ts:2563) hard-deletes the booking
--     after recording the date in booking_series.skip_dates — so the owner
--     honouring the client's skip request would destroy the request itself.
--   * updateBookingAction's series-regenerate branch deletes and re-inserts
--     every future sibling when the recurrence schedule changes.
-- Hence booking_id ON DELETE SET NULL, plus a denormalized
-- (series_id, occurrence_date) pair that survives the row and lets a
-- regenerated occupant of the same slot pick the note back up.

CREATE TABLE IF NOT EXISTS public.client_job_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES public.clients(id)       ON DELETE CASCADE,

  -- Nullable and SET NULL on purpose: see the delete paths above.
  booking_id       uuid REFERENCES public.bookings(id)       ON DELETE SET NULL,
  series_id        uuid REFERENCES public.booking_series(id) ON DELETE SET NULL,

  -- ORG-LOCAL calendar date of the visit (YYYY-MM-DD) — the same key
  -- booking_series.skip_dates and recurrence.isSkipped use. Storing the UTC
  -- date here would repeat a bug already fixed once: for an evening booking in
  -- a negative-offset timezone it is the NEXT day, never matches, and the
  -- nightly cron keeps regenerating the skipped job (actions.ts:2530-2535).
  occurrence_date  date,

  kind             text NOT NULL
                     CHECK (kind IN ('job_note','skip_occurrence')),

  body             text,

  -- Mirrors shift_change_requests. 'open' means a human still has to look.
  -- An auto-applied skip is inserted already resolved, so the office queue
  -- only ever holds things that need a decision.
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','resolved')),
  auto_applied     boolean NOT NULL DEFAULT false,

  resolved_by      uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  resolved_at      timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- A note with no text is not a note.
  CONSTRAINT client_job_requests_note_body_check
    CHECK (kind <> 'job_note' OR (body IS NOT NULL AND length(btrim(body)) > 0)),

  -- A skip must name the visit it skips in org-local terms, or it cannot be
  -- reconciled against skip_dates once the booking row is gone.
  CONSTRAINT client_job_requests_skip_target_check
    CHECK (kind <> 'skip_occurrence' OR occurrence_date IS NOT NULL),

  CONSTRAINT client_job_requests_resolved_at_check
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

-- The office queue: what have clients asked for that nobody has handled.
CREATE INDEX IF NOT EXISTS client_job_requests_org_status_idx
  ON public.client_job_requests (organization_id, status);

-- Field app + office booking detail: everything said about THIS booking.
CREATE INDEX IF NOT EXISTS client_job_requests_booking_idx
  ON public.client_job_requests (booking_id);

-- Re-attaching a note after series regeneration replaces the booking row.
CREATE INDEX IF NOT EXISTS client_job_requests_series_date_idx
  ON public.client_job_requests (series_id, occurrence_date);

ALTER TABLE public.client_job_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_job_requests FORCE ROW LEVEL SECURITY;

-- Org members read everything in their org.
--
-- All roles, not managers-only: shift_change_requests is an owner inbox, but a
-- client job note has to reach the CLEANER, and the field job screen reads
-- through the RLS-bound server client. This lets a cleaner see client notes on
-- jobs they are not assigned to, which matches the exposure clients.notes
-- already has via "members read clients" — every cleaner can already read
-- every client's standing note in the org.
DROP POLICY IF EXISTS "members read client job requests" ON public.client_job_requests;
CREATE POLICY "members read client job requests"
ON public.client_job_requests FOR SELECT
TO authenticated
USING (organization_id IN (SELECT public.current_user_org_ids()));

-- Managers/admins/owners mark a request handled.
DROP POLICY IF EXISTS "managers update client job requests" ON public.client_job_requests;
CREATE POLICY "managers update client job requests"
ON public.client_job_requests FOR UPDATE
TO authenticated
USING (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
WITH CHECK (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- The owning client reads their own requests back, so the portal can show
-- "asked Aug 6 — handled". booking_requests never got this policy, which is
-- why a client can submit a booking request and never see it again.
--
-- A portal client has no memberships row, so current_user_org_ids() is empty
-- for them and the members policy above admits nothing. The two permissive
-- SELECT policies OR together without either widening the other.
DROP POLICY IF EXISTS "clients read own job requests" ON public.client_job_requests;
CREATE POLICY "clients read own job requests"
ON public.client_job_requests FOR SELECT
TO authenticated
USING (client_id IN (
  SELECT id FROM public.clients WHERE profile_id = auth.uid()
));

-- NO client INSERT or UPDATE policy, deliberately, matching the rule already
-- documented in src/app/client/(portal)/request/actions.ts: the portal writes
-- through server actions only. Two independent reasons:
--   1. Postgres RLS has no OLD/NEW pair — USING sees the existing row, WITH
--      CHECK the proposed one, and no single expression sees both. A client
--      UPDATE policy grants every column the authenticated role can write on
--      every row it admits; there is no column-scoped RLS UPDATE policy.
--      Column GRANTs cannot fence it either, because staff and clients both
--      arrive as the `authenticated` role.
--   2. Eligibility is per-kind and time-dependent (in the future, not in
--      progress, not archived, outside the auto-apply window). That is
--      imperative logic, not a predicate.

DROP TRIGGER IF EXISTS client_job_requests_set_updated_at ON public.client_job_requests;
CREATE TRIGGER client_job_requests_set_updated_at
  BEFORE UPDATE ON public.client_job_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.client_job_requests IS
  'Things a portal client says about a booking they already have: a note for one visit, or a skip. Written by server actions on the service role after requireClient(); no client INSERT/UPDATE policy exists.';
COMMENT ON COLUMN public.client_job_requests.occurrence_date IS
  'ORG-LOCAL calendar date of the visit (YYYY-MM-DD) — the same key booking_series.skip_dates uses. Survives booking_id being nulled by an applied skip or by series regeneration.';
COMMENT ON COLUMN public.client_job_requests.auto_applied IS
  'True when the system applied the request without a human. Such rows are inserted status=resolved so the office queue only holds open decisions.';
