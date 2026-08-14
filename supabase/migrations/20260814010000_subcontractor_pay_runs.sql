-- =============================================================================
-- Subcontractor pay runs — the bi-weekly statement, done the payroll way
-- supabase/migrations/20260814010000_subcontractor_pay_runs.sql
-- =============================================================================
-- Svitlana pays her subcontractors every two weeks (#83). Until now the only
-- record was the payables page's running balance: earned is DERIVED from
-- unstamped hours, payouts net against it, and nothing ever freezes a period
-- — so an entry edited after payday silently rewrites what was owed, and no
-- document says "this fortnight, these hours, this amount".
--
-- Payroll solved the identical problem for employees: snapshot a period into
-- a run + per-person items, stamp the consumed rows so no later run can pay
-- them again. This is that, for the other pay system:
--
--   subcontractor_pay_runs    one generated period (finalized -> paid)
--   subcontractor_pay_items   one subcontractor's hours + total in that run
--   time_entries.subcontractor_run_id   the stamp
--
-- Rules the code enforces on top:
--   * Only SUB-ERA hours enter a run (engagement_snapshot, 20260813010000) —
--     the same partition that keeps payroll and this system from double-pay.
--   * needs_review hours block generation, exactly like payroll refuses
--     them: a capped shift must be confirmed before it becomes money.
--   * Accounting: items of an unpaid run still count as owed on the payables
--     page (generating a statement is not paying it); marking the run paid
--     retires them in one step. ON DELETE SET NULL releases entries if an
--     unpaid run is deleted, so regeneration is always possible.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.subcontractor_pay_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start       date NOT NULL,
  period_end         date NOT NULL CHECK (period_end >= period_start),
  status             text NOT NULL DEFAULT 'finalized'
                     CHECK (status IN ('finalized','paid')),
  total_cents        integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes              text,
  created_by         uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subcontractor_pay_runs_org_idx
  ON public.subcontractor_pay_runs (organization_id, period_start DESC);

DROP TRIGGER IF EXISTS subcontractor_pay_runs_set_updated_at ON public.subcontractor_pay_runs;
CREATE TRIGGER subcontractor_pay_runs_set_updated_at
BEFORE UPDATE ON public.subcontractor_pay_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.subcontractor_pay_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES public.subcontractor_pay_runs(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id      uuid NOT NULL REFERENCES public.memberships(id) ON DELETE RESTRICT,
  -- Snapshot, like payroll_items.employee_name: the statement must keep
  -- saying who it paid even if the roster row is later renamed or removed.
  payee_name         text NOT NULL,
  minutes            integer NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  entry_count        integer NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  total_cents        integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, membership_id)
);

CREATE INDEX IF NOT EXISTS subcontractor_pay_items_run_idx
  ON public.subcontractor_pay_items (run_id);
CREATE INDEX IF NOT EXISTS subcontractor_pay_items_membership_idx
  ON public.subcontractor_pay_items (membership_id);

-- The stamp. SET NULL so deleting an unpaid run releases its hours back to
-- the floating balance — same recovery property payroll_run_id has.
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS subcontractor_run_id uuid
    REFERENCES public.subcontractor_pay_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS time_entries_subcontractor_run_idx
  ON public.time_entries (subcontractor_run_id)
  WHERE subcontractor_run_id IS NOT NULL;

ALTER TABLE public.subcontractor_pay_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractor_pay_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read own org subcontractor_pay_runs"
ON public.subcontractor_pay_runs FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin','manager')
  )
);

CREATE POLICY "admins manage own org subcontractor_pay_runs"
ON public.subcontractor_pay_runs FOR ALL
USING (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin')
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin')
  )
);

CREATE POLICY "admins read own org subcontractor_pay_items"
ON public.subcontractor_pay_items FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin','manager')
  )
);

CREATE POLICY "admins manage own org subcontractor_pay_items"
ON public.subcontractor_pay_items FOR ALL
USING (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin')
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin')
  )
);

COMMENT ON TABLE public.subcontractor_pay_runs IS
  'A generated pay-period statement for subcontractors — the payroll-run shape applied to the other pay system. finalized = generated and owed; paid = settled. Entries consumed by a run are stamped via time_entries.subcontractor_run_id.';
COMMENT ON COLUMN public.time_entries.subcontractor_run_id IS
  'Which subcontractor pay run consumed this entry. NULL = still floating in the payables balance. Sibling of payroll_run_id — one entry can only ever be consumed by the system matching its engagement_snapshot.';

notify pgrst, 'reload schema';
