/**
 * How a person on the roster is engaged — and therefore how they get paid.
 *
 * Sollos models THREE kinds of worker, and until now only had columns for two
 * of them, which is what caused the confusion this exists to end:
 *
 *   employee        On the roster. Paid through EMPLOYEE PAY (a payroll run).
 *   subcontractor   On the roster. Logs in, is assigned shifts, accepts them,
 *                   clocks in — operationally identical to an employee. Paid
 *                   through SUBCONTRACTOR PAY, never through payroll.
 *   outsourcing     NOT on the roster. A freelancer_contacts row: no login, no
 *                   clock-in. Gets open shifts broadcast by SMS and claims
 *                   them. Also paid through SUBCONTRACTOR PAY.
 *
 * Only the first two are an `engagement`; the third is a different table
 * entirely. The UI used to call that third thing "subcontractors", which is
 * why an owner asking to "add a subcontractor" got sent to a bench of external
 * people instead of their own crew.
 *
 * ORTHOGONAL to two columns it is constantly confused with:
 *   role      PERMISSIONS — owner | admin | manager | employee
 *   pay_type  RATE BASIS  — hourly | flat | percent
 * A subcontractor can be a manager. An employee can be on a flat rate.
 */

export const ENGAGEMENTS = ["employee", "subcontractor"] as const;
export type Engagement = (typeof ENGAGEMENTS)[number];

/** Anything not explicitly a subcontractor is an employee — matches the DB
 *  default, so a row written before this column existed reads correctly. */
export function toEngagement(raw: unknown): Engagement {
  return raw === "subcontractor" ? "subcontractor" : "employee";
}

export function isSubcontractor(raw: unknown): boolean {
  return toEngagement(raw) === "subcontractor";
}

export const ENGAGEMENT_LABEL: Record<Engagement, string> = {
  employee: "Employee",
  subcontractor: "Subcontractor",
};

/** Shown under the picker, so whoever is adding a person knows what changes. */
export const ENGAGEMENT_HELP: Record<Engagement, string> = {
  employee: "Paid through payroll. Accrues PTO and overtime.",
  subcontractor:
    "Paid through Subcontractor pay — record their invoices and payments there. No payroll, PTO or overtime.",
};

/**
 * Which pay system a person belongs to. One or the other, never both, never
 * neither — that is the whole safety property of this feature.
 *
 * Being paid twice for the same shift and being paid nothing at all are both
 * possible if this is decided in more than one place, so every call site reads
 * it from here.
 */
export function paySystemFor(raw: unknown): "payroll" | "subcontractor-pay" {
  return isSubcontractor(raw) ? "subcontractor-pay" : "payroll";
}

/**
 * Things that are only true of employees.
 *
 * PTO and overtime are not merely inapplicable to a contractor — offering them
 * is documentary evidence against the contractor relationship the business is
 * asserting. A weekly "you're approaching overtime" email to someone the
 * company calls self-employed is the kind of thing that decides a CRA
 * misclassification review.
 */
export function accruesPto(raw: unknown): boolean {
  return !isSubcontractor(raw);
}

export function accruesOvertime(raw: unknown): boolean {
  return !isSubcontractor(raw);
}
