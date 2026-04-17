-- =============================================================================
-- Payroll runs — snapshot a pay period's hours + pay per employee
-- =============================================================================
-- A payroll run is a point-in-time record of what each employee earned over
-- a specific date range. Created by admins/owners from the Payroll page.
-- Immutable once finalized — changes require a correcting run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start       date NOT NULL,
  period_end         date NOT NULL CHECK (period_end >= period_start),
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','finalized','paid')),
  total_cents        integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes              text,
  created_by         uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  finalized_at       timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_runs_org_idx
  ON public.payroll_runs (organization_id, period_start DESC);

DROP TRIGGER IF EXISTS payroll_runs_set_updated_at ON public.payroll_runs;
CREATE TRIGGER payroll_runs_set_updated_at
BEFORE UPDATE ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id     uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES public.memberships(id) ON DELETE RESTRICT,
  employee_name      text NOT NULL,
  hours_worked       numeric(10,2) NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
  regular_pay_cents  integer NOT NULL DEFAULT 0 CHECK (regular_pay_cents >= 0),
  bonus_cents        integer NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
  pto_hours          numeric(10,2) NOT NULL DEFAULT 0 CHECK (pto_hours >= 0),
  pto_pay_cents      integer NOT NULL DEFAULT 0 CHECK (pto_pay_cents >= 0),
  total_cents        integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_items_run_idx
  ON public.payroll_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS payroll_items_employee_idx
  ON public.payroll_items (employee_id);

ALTER TABLE public.payroll_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read own org payroll_runs"
ON public.payroll_runs FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin')
  )
);

CREATE POLICY "admins manage own org payroll_runs"
ON public.payroll_runs FOR ALL
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

CREATE POLICY "members read own org payroll_items"
ON public.payroll_items FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner','admin')
  )
);

CREATE POLICY "admins manage own org payroll_items"
ON public.payroll_items FOR ALL
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
