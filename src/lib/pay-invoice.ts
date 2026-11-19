/**
 * A pay invoice: one person's pay for one pay period, laid out as an invoice
 * from that person to the company, for both sides' records.
 *
 * It is a VIEW of a pay run that already exists. Nothing here decides what
 * anyone is paid:
 *
 *   employee    -> one payroll_items row (a pay period run from Payroll)
 *   contractor  -> one subcontractor_pay_items row (a contractor statement)
 *
 * The total is always the run's own frozen figure. The lines are rebuilt
 * from what the run stamped (time entries, bonuses, time off, add-ons) with
 * the same arithmetic the run used: minutes x rate / 60, rounded per shift,
 * snapshot rate first and the person's rate second. If the rebuilt lines
 * ever fail to add up to the frozen total (a rate changed after a run priced
 * an entry that had no snapshot), one "Adjustment" line makes up the
 * difference, so the invoice can never disagree with what was paid.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { getOrgCurrency } from "@/lib/org-currency";
import { resolvePayRate } from "@/lib/pay-rate";
import { humanizeEnum, type CurrencyCode } from "@/lib/format";

export type PayInvoiceKind = "employee" | "contractor";

export type PayInvoiceLine = {
  /** e.g. "Nov 3, 2026". Empty for lines with no single day. */
  date: string;
  description: string;
  /** e.g. "9:00 AM - 11:30 AM". */
  detail: string | null;
  /** Hours for a time line; null for a fixed amount. */
  hours: number | null;
  rateCents: number | null;
  amountCents: number;
};

export type PayInvoice = {
  kind: PayInvoiceKind;
  itemId: string;
  organizationId: string;
  /** The person the invoice is from. */
  membershipId: string;
  number: string;
  workerName: string;
  workerEmail: string | null;
  companyName: string;
  brandColor: string | null;
  currency: CurrencyCode;
  periodStart: string;
  periodEnd: string;
  /** Org-local YYYY-MM-DD the run was made final (or created). */
  issuedOn: string;
  runStatus: "draft" | "finalized" | "paid";
  /** Org-local YYYY-MM-DD it was marked paid, when it was. */
  paidOn: string | null;
  lines: PayInvoiceLine[];
  totalHours: number;
  totalCents: number;
};

type Db = ReturnType<typeof createSupabaseAdminClient>;

function ymdIn(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function dayLabel(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}
function timeLabel(tz: string, iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
/** A DATE column (no time of day), labelled without a zone shift. */
function dateOnlyLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`));
}

/** PAY-20261115-A1B2C3: period end plus the start of the item's own id. */
export function payInvoiceNumber(kind: PayInvoiceKind, periodEnd: string, itemId: string): string {
  const tail = itemId.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${kind === "contractor" ? "SUB" : "PAY"}-${periodEnd.replace(/-/g, "")}-${tail}`;
}

type EntryRow = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  pay_rate_cents_snapshot: number | null;
  booking: {
    service_type: string | null;
    service_type_label: string | null;
    client: { name: string | null } | null;
  } | null;
};

async function shiftLines(
  db: Db,
  tz: string,
  organizationId: string,
  membershipId: string,
  runColumn: "payroll_run_id" | "subcontractor_run_id",
  runId: string,
  memberRateCents: number | null,
): Promise<{ lines: PayInvoiceLine[]; minutes: number; cents: number }> {
  const rows: EntryRow[] = [];
  // Every page: a busy cleaner over a long period can pass 1,000 shifts.
  for (let from = 0; ; from += 1000) {
    const { data, error } = (await db
      .from("time_entries")
      .select(
        "id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, booking:bookings ( service_type, service_type_label, client:clients ( name ) )" as never,
      )
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .eq(runColumn as never, runId as never)
      .order("clock_in_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999)) as unknown as {
      data: EntryRow[] | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(`pay invoice: reading shifts failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const lines: PayInvoiceLine[] = [];
  let minutes = 0;
  let cents = 0;
  for (const e of rows) {
    if (!e.clock_out_at) continue;
    const mins = Math.max(0, Math.round((new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime()) / 60_000));
    const rate = resolvePayRate(e.pay_rate_cents_snapshot, memberRateCents);
    if (rate == null) continue;
    const amount = Math.round((mins * rate) / 60);
    const service = e.booking?.service_type_label ?? (e.booking?.service_type ? humanizeEnum(e.booking.service_type) : null);
    const client = e.booking?.client?.name ?? null;
    lines.push({
      date: dayLabel(tz, e.clock_in_at),
      description: client ? (service ? `${client} - ${service}` : client) : (service ?? "Shift"),
      detail: `${timeLabel(tz, e.clock_in_at)} - ${timeLabel(tz, e.clock_out_at)}`,
      hours: Math.round((mins / 60) * 100) / 100,
      rateCents: rate,
      amountCents: amount,
    });
    minutes += mins;
    cents += amount;
  }
  return { lines, minutes, cents };
}

async function memberOf(db: Db, organizationId: string, membershipId: string) {
  const { data } = (await db
    .from("memberships")
    .select("id, display_name, contact_email, pay_rate_cents, profile:profiles ( full_name )" as never)
    .eq("id", membershipId)
    .eq("organization_id", organizationId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      display_name: string | null;
      contact_email: string | null;
      pay_rate_cents: number | null;
      profile: { full_name: string | null } | null;
    } | null;
  };
  return data;
}

async function companyOf(db: Db, organizationId: string) {
  const { data } = (await db
    .from("organizations")
    .select("name, brand_color")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as { data: { name: string; brand_color: string | null } | null };
  return data;
}

/** Add a balancing line when the rebuilt lines and the frozen total differ. */
function reconcile(lines: PayInvoiceLine[], frozenTotalCents: number): void {
  const sum = lines.reduce((s, l) => s + l.amountCents, 0);
  const gap = frozenTotalCents - sum;
  if (gap !== 0) {
    lines.push({
      date: "",
      description: "Adjustment to match the pay run",
      detail: null,
      hours: null,
      rateCents: null,
      amountCents: gap,
    });
  }
}

/**
 * Load one pay invoice. Returns null when the item doesn't exist. The caller
 * decides who may see it: `organizationId`, `membershipId` and `runStatus`
 * are on the result for exactly that.
 */
export async function loadPayInvoice(kind: PayInvoiceKind, itemId: string): Promise<PayInvoice | null> {
  const db = createSupabaseAdminClient();

  if (kind === "employee") {
    const { data: item } = (await db
      .from("payroll_items")
      .select(
        "id, organization_id, employee_id, employee_name, hours_worked, regular_pay_cents, bonus_cents, pto_hours, pto_pay_cents, total_cents, run:payroll_runs!inner ( id, period_start, period_end, status, finalized_at, paid_at, created_at )" as never,
      )
      .eq("id", itemId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        employee_id: string;
        employee_name: string;
        hours_worked: number;
        regular_pay_cents: number;
        bonus_cents: number;
        pto_hours: number;
        pto_pay_cents: number;
        total_cents: number;
        run: {
          id: string;
          period_start: string;
          period_end: string;
          status: "draft" | "finalized" | "paid";
          finalized_at: string | null;
          paid_at: string | null;
          created_at: string;
        } | null;
      } | null;
    };
    if (!item || !item.run) return null;

    const [tz, currency, member, company] = await Promise.all([
      getOrgTimezone(item.organization_id),
      getOrgCurrency(item.organization_id),
      memberOf(db, item.organization_id, item.employee_id),
      companyOf(db, item.organization_id),
    ]);

    const shifts = await shiftLines(db, tz, item.organization_id, item.employee_id, "payroll_run_id", item.run.id, member?.pay_rate_cents ?? null);
    const lines = [...shifts.lines];
    // Regular pay is its own frozen figure: balance the shifts against it
    // before the other kinds of pay are listed.
    reconcile(lines, item.regular_pay_cents);

    const { data: bonuses } = (await db
      .from("bonuses")
      .select("amount_cents, reason, bonus_type, period_end")
      .eq("organization_id", item.organization_id)
      .eq("employee_id", item.employee_id)
      .eq("payroll_run_id", item.run.id)
      .order("created_at", { ascending: true })) as unknown as {
      data: Array<{ amount_cents: number; reason: string | null; bonus_type: string | null; period_end: string | null }> | null;
    };
    const bonusLines: PayInvoiceLine[] = (bonuses ?? []).map((b) => ({
      date: b.period_end ? dateOnlyLabel(b.period_end) : "",
      description: `Bonus${b.bonus_type ? ` (${humanizeEnum(b.bonus_type).toLowerCase()})` : ""}`,
      detail: b.reason,
      hours: null,
      rateCents: null,
      amountCents: b.amount_cents ?? 0,
    }));
    reconcile(bonusLines, item.bonus_cents);
    lines.push(...bonusLines);

    // Corrections to earlier pay, each with the note the office wrote.
    // Read on their own so a statement still opens on a database that
    // doesn't have the table yet.
    try {
      const { data: adjustments } = (await db
        .from("pay_adjustments" as never)
        .select("amount_cents, reason, corrects_period_start, corrects_period_end" as never)
        .eq("organization_id" as never, item.organization_id as never)
        .eq("employee_id" as never, item.employee_id as never)
        .eq("payroll_run_id" as never, item.run.id as never)
        .order("created_at" as never, { ascending: true } as never)) as unknown as {
        data: Array<{
          amount_cents: number;
          reason: string;
          corrects_period_start: string | null;
          corrects_period_end: string | null;
        }> | null;
      };
      for (const a of adjustments ?? []) {
        const period =
          a.corrects_period_start && a.corrects_period_end
            ? ` (for ${dateOnlyLabel(a.corrects_period_start)} to ${dateOnlyLabel(a.corrects_period_end)})`
            : "";
        lines.push({
          date: "",
          description: `Pay adjustment${period}`,
          detail: a.reason,
          hours: null,
          rateCents: null,
          amountCents: a.amount_cents ?? 0,
        });
      }
    } catch (err) {
      console.error("[pay-invoice] adjustments read failed:", err);
    }

    if (item.pto_pay_cents !== 0 || Number(item.pto_hours) !== 0) {
      const { data: pto } = (await db
        .from("pto_requests")
        .select("start_date, end_date, hours" as never)
        .eq("organization_id", item.organization_id)
        .eq("employee_id", item.employee_id)
        .eq("payroll_run_id" as never, item.run.id as never)
        .order("start_date" as never, { ascending: true } as never)) as unknown as {
        data: Array<{ start_date: string; end_date: string; hours: number }> | null;
      };
      const days = (pto ?? [])
        .map((p) => (p.start_date === p.end_date ? dateOnlyLabel(p.start_date) : `${dateOnlyLabel(p.start_date)} to ${dateOnlyLabel(p.end_date)}`))
        .join("; ");
      const hours = Number(item.pto_hours) || 0;
      lines.push({
        date: "",
        description: "Paid time off",
        detail: days || null,
        hours,
        rateCents: hours > 0 ? Math.round(item.pto_pay_cents / hours) : null,
        amountCents: item.pto_pay_cents,
      });
    }

    reconcile(lines, item.total_cents);

    return {
      kind,
      itemId: item.id,
      organizationId: item.organization_id,
      membershipId: item.employee_id,
      number: payInvoiceNumber(kind, item.run.period_end, item.id),
      // The name the pay run itself recorded, so the invoice and the run agree.
      workerName: item.employee_name || member?.profile?.full_name || member?.display_name || "",
      workerEmail: member?.contact_email ?? null,
      companyName: company?.name ?? "",
      brandColor: company?.brand_color ?? null,
      currency,
      periodStart: item.run.period_start,
      periodEnd: item.run.period_end,
      issuedOn: ymdIn(tz, item.run.finalized_at ?? item.run.created_at),
      runStatus: item.run.status,
      paidOn: item.run.paid_at ? ymdIn(tz, item.run.paid_at) : null,
      lines,
      totalHours: Number(item.hours_worked) + (Number(item.pto_hours) || 0),
      totalCents: item.total_cents,
    };
  }

  // ── Contractor statement line ──
  const { data: item } = (await db
    .from("subcontractor_pay_items" as never)
    .select(
      "id, organization_id, membership_id, payee_name, minutes, total_cents, run:subcontractor_pay_runs!inner ( id, period_start, period_end, status, paid_at, created_at )" as never,
    )
    .eq("id" as never, itemId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      membership_id: string;
      payee_name: string;
      minutes: number;
      total_cents: number;
      run: {
        id: string;
        period_start: string;
        period_end: string;
        status: string;
        paid_at: string | null;
        created_at: string;
      } | null;
    } | null;
  };
  if (!item || !item.run) return null;

  const [tz, currency, member, company] = await Promise.all([
    getOrgTimezone(item.organization_id),
    getOrgCurrency(item.organization_id),
    memberOf(db, item.organization_id, item.membership_id),
    companyOf(db, item.organization_id),
  ]);

  const shifts = await shiftLines(db, tz, item.organization_id, item.membership_id, "subcontractor_run_id", item.run.id, member?.pay_rate_cents ?? null);
  const lines = [...shifts.lines];

  const { data: addons } = (await db
    .from("pay_addons" as never)
    .select("kind, amount_cents, work_date, note")
    .eq("organization_id" as never, item.organization_id as never)
    .eq("membership_id" as never, item.membership_id as never)
    .eq("subcontractor_run_id" as never, item.run.id as never)
    .order("work_date" as never, { ascending: true } as never)) as unknown as {
    data: Array<{ kind: string; amount_cents: number; work_date: string; note: string }> | null;
  };
  for (const a of addons ?? []) {
    lines.push({
      date: dateOnlyLabel(a.work_date),
      description: a.kind === "reimbursement" ? "Reimbursement" : a.kind === "travel" ? "Travel" : "Other",
      detail: a.note,
      hours: null,
      rateCents: null,
      amountCents: a.amount_cents,
    });
  }

  reconcile(lines, item.total_cents);

  return {
    kind,
    itemId: item.id,
    organizationId: item.organization_id,
    membershipId: item.membership_id,
    number: payInvoiceNumber(kind, item.run.period_end, item.id),
    workerName: item.payee_name || member?.profile?.full_name || member?.display_name || "",
    workerEmail: member?.contact_email ?? null,
    companyName: company?.name ?? "",
    brandColor: company?.brand_color ?? null,
    currency,
    periodStart: item.run.period_start,
    periodEnd: item.run.period_end,
    issuedOn: ymdIn(tz, item.run.created_at),
    runStatus: item.run.status === "paid" ? "paid" : item.run.status === "draft" ? "draft" : "finalized",
    paidOn: item.run.paid_at ? ymdIn(tz, item.run.paid_at) : null,
    lines,
    totalHours: Math.round((item.minutes / 60) * 100) / 100,
    totalCents: item.total_cents,
  };
}
