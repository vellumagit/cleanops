/**
 * Every pay invoice a company has, or every one a single person has.
 *
 * One row per person per pay run: the same thing lib/pay-invoice turns into
 * a PDF, as a list. It reads both pay systems (employee pay runs and
 * contractor statements) and every page of each, so nothing drops off the
 * end after a year the way the 26-statement card does.
 *
 * Service-role read. The caller decides who may see the list.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allPages } from "@/lib/supabase/all-pages";
import { payInvoiceNumber, type PayInvoiceKind } from "@/lib/pay-invoice";

export type PayInvoiceRow = {
  kind: PayInvoiceKind;
  itemId: string;
  membershipId: string;
  name: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  totalCents: number;
  status: "draft" | "finalized" | "paid";
  paidAt: string | null;
};

type Run = { period_start: string; period_end: string; status: string; paid_at: string | null };

function statusOf(s: string): PayInvoiceRow["status"] {
  return s === "paid" ? "paid" : s === "draft" ? "draft" : "finalized";
}

export async function listPayInvoices(
  organizationId: string,
  opts: { membershipId?: string; kinds?: PayInvoiceKind[] } = {},
): Promise<PayInvoiceRow[]> {
  const db = createSupabaseAdminClient();
  const kinds = opts.kinds ?? ["employee", "contractor"];
  const rows: PayInvoiceRow[] = [];

  if (kinds.includes("employee")) {
    const items = await allPages<{
      id: string;
      employee_id: string;
      employee_name: string;
      hours_worked: number;
      pto_hours: number;
      total_cents: number;
      run: Run | null;
    }>((from, to) => {
      let q = db
        .from("payroll_items")
        .select(
          "id, employee_id, employee_name, hours_worked, pto_hours, total_cents, run:payroll_runs!inner ( period_start, period_end, status, paid_at )" as never,
        )
        .eq("organization_id", organizationId);
      if (opts.membershipId) q = q.eq("employee_id", opts.membershipId);
      return q.order("id", { ascending: true }).range(from, to) as never;
    }, "pay invoices (employees)");
    for (const i of items) {
      if (!i.run) continue;
      rows.push({
        kind: "employee",
        itemId: i.id,
        membershipId: i.employee_id,
        name: i.employee_name,
        number: payInvoiceNumber("employee", i.run.period_end, i.id),
        periodStart: i.run.period_start,
        periodEnd: i.run.period_end,
        hours: Number(i.hours_worked) + (Number(i.pto_hours) || 0),
        totalCents: i.total_cents,
        status: statusOf(i.run.status),
        paidAt: i.run.paid_at,
      });
    }
  }

  if (kinds.includes("contractor")) {
    const items = await allPages<{
      id: string;
      membership_id: string;
      payee_name: string;
      minutes: number;
      total_cents: number;
      run: Run | null;
    }>((from, to) => {
      let q = db
        .from("subcontractor_pay_items" as never)
        .select(
          "id, membership_id, payee_name, minutes, total_cents, run:subcontractor_pay_runs!inner ( period_start, period_end, status, paid_at )" as never,
        )
        .eq("organization_id" as never, organizationId as never);
      if (opts.membershipId) q = q.eq("membership_id" as never, opts.membershipId as never);
      return q.order("id" as never, { ascending: true } as never).range(from, to) as never;
    }, "pay invoices (contractors)");
    for (const i of items) {
      if (!i.run) continue;
      rows.push({
        kind: "contractor",
        itemId: i.id,
        membershipId: i.membership_id,
        name: i.payee_name,
        number: payInvoiceNumber("contractor", i.run.period_end, i.id),
        periodStart: i.run.period_start,
        periodEnd: i.run.period_end,
        hours: Math.round((i.minutes / 60) * 100) / 100,
        totalCents: i.total_cents,
        status: statusOf(i.run.status),
        paidAt: i.run.paid_at,
      });
    }
  }

  // Newest period first; within a period, by name, then number so the order
  // never shuffles between loads.
  return rows.sort(
    (a, b) =>
      b.periodEnd.localeCompare(a.periodEnd) ||
      b.periodStart.localeCompare(a.periodStart) ||
      a.name.localeCompare(b.name) ||
      a.number.localeCompare(b.number),
  );
}
