"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { can } from "@/lib/auth";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { z } from "zod";
import { estimateLinesTotalCents, parseEstimateLines } from "@/lib/estimate-lines";
import { parseTaxRate } from "@/lib/invoice-tax";

const CADENCES = ["weekly", "biweekly", "monthly", "quarterly"] as const;
type Cadence = (typeof CADENCES)[number];

const SeriesSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  name: z.string().min(1, "Name required").max(200),
  cadence: z.enum(CADENCES),
  amount_cents: z.coerce.number().int().min(0, "Amount can't be negative"),
  due_days: z.coerce.number().int().min(0).max(180).default(14),
  next_run_at: z.string().min(1, "Pick a start date"),
  notes: z.string().optional().nullable(),
  line_items: z.string().optional(), // JSON string; optional
});

export type RecurringInvoiceState = {
  errors?: Partial<Record<string, string>>;
  values?: Record<string, string>;
};

/**
 * The date the office picked ("2026-12-01"), as the start of that day in the
 * COMPANY's timezone. `new Date("2026-12-01")` is UTC midnight, which is
 * 6 pm on Nov 30 in Alberta: the list then showed "Next run: Nov 30" for a
 * series set to start Dec 1. A full timestamp passes through unchanged.
 */
async function firstRunInstant(picked: string, organizationId: string): Promise<string> {
  if (/^\d{4}-\d{2}-\d{2}$/.test(picked)) {
    return localInputToUtcIso(`${picked}T00:00`, await getOrgTimezone(organizationId));
  }
  return new Date(picked).toISOString();
}

/** Managers need the Invoices switch, like every other invoice action. */
function mayManageStanding(membership: Awaited<ReturnType<typeof getActionContext>>["membership"]): boolean {
  return ["owner", "admin", "manager"].includes(membership.role) && can(membership, "invoicing");
}

function readForm(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    name: String(formData.get("name") ?? ""),
    cadence: String(formData.get("cadence") ?? "monthly") as Cadence,
    amount_cents: Math.round(
      Number(String(formData.get("amount_dollars") ?? "0").replace(/[^0-9.]/g, "")) * 100,
    ),
    due_days: Number(formData.get("due_days") ?? 14),
    next_run_at: String(formData.get("next_run_at") ?? ""),
    notes: String(formData.get("notes") ?? "").trim() || null,
    // The rows from the lines editor (it was a box of JSON to type into).
    line_items: String(formData.get("line_items_json") ?? "").trim(),
  };
}

/**
 * The form's rows and tax option, as the series stores them.
 *
 * With rows, the series' amount IS their sum: a typed amount that disagreed
 * with its own lines would bill a total its invoice can't add up to. With
 * none, the typed amount stands and the generator writes one line for it.
 * The amount is before tax; the generator adds the tax to each invoice.
 */
function readLinesAndTax(
  formData: FormData,
  rawLines: string,
  typedAmountCents: number,
):
  | { ok: true; lineItems: Array<{ label: string; quantity: number; unit_price_cents: number }>; amountCents: number; taxRateBps: number | null; taxLabel: string | null }
  | { ok: false; errors: Record<string, string> } {
  const { lines, error } = parseEstimateLines(rawLines);
  if (error) return { ok: false, errors: { line_items: error } };

  // The rate field only exists in the form while "Charge tax" is ticked.
  let taxRateBps: number | null = null;
  let taxLabel: string | null = null;
  if (formData.has("tax_rate_percent")) {
    taxRateBps = parseTaxRate(String(formData.get("tax_rate_percent") ?? ""));
    if (!taxRateBps || taxRateBps <= 0) {
      return { ok: false, errors: { tax_rate_percent: "Type a tax rate (5 for 5%), or untick Charge tax." } };
    }
    taxLabel = String(formData.get("tax_label") ?? "").trim().slice(0, 40) || null;
  }

  return {
    ok: true,
    lineItems: lines.map((l) => ({ label: l.label, quantity: l.quantity, unit_price_cents: l.unit_price_cents })),
    amountCents: lines.length > 0 ? estimateLinesTotalCents(lines) : typedAmountCents,
    taxRateBps,
    taxLabel,
  };
}

/**
 * The client a standing invoice bills must be one of this company's. The
 * form's picker only lists them, but the action took any id: the database
 * rule on invoice_series checks the series' company, not the client's, so a
 * series could be saved against another company's client and billed nightly.
 */
async function isOwnClient(
  supabase: Awaited<ReturnType<typeof getActionContext>>["supabase"],
  organizationId: string,
  clientId: string,
): Promise<boolean> {
  const { data } = (await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  return Boolean(data);
}

export async function createRecurringInvoiceAction(
  _prev: RecurringInvoiceState,
  formData: FormData,
): Promise<RecurringInvoiceState> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { errors: { _form: "Not authorized." } };
  }
  if (!mayManageStanding(membership)) {
    return { errors: { _form: "Recurring invoices aren't part of your access." } };
  }

  const raw = readForm(formData);
  const parsed = SeriesSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "_form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { errors, values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])) };
  }

  const read = readLinesAndTax(formData, parsed.data.line_items ?? "", parsed.data.amount_cents);
  if (!read.ok) {
    return { errors: read.errors, values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])) };
  }
  const lineItems = read.lineItems;

  if (!(await isOwnClient(supabase, membership.organization_id, parsed.data.client_id))) {
    return {
      errors: { client_id: "Pick one of your clients." },
      values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])),
    };
  }

  const firstRun = await firstRunInstant(parsed.data.next_run_at, membership.organization_id);
  const { error } = await (supabase
    .from("invoice_series" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      amount_cents: read.amountCents,
      tax_rate_bps: read.taxRateBps,
      tax_label: read.taxLabel,
      due_days: parsed.data.due_days,
      next_run_at: firstRun,
      // The day of the month this series bills on; later runs aim for it.
      anchor_day: new Date(firstRun).getUTCDate(),
      notes: parsed.data.notes,
      line_items: lineItems,
      active: true,
      created_by: membership.id,
    } as never) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) {
    return {
      errors: { _form: error.message },
      values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])),
    };
  }

  revalidatePath("/app/settings/recurring-invoices");
  redirect("/app/settings/recurring-invoices");
}

export async function updateRecurringInvoiceAction(
  id: string,
  _prev: RecurringInvoiceState,
  formData: FormData,
): Promise<RecurringInvoiceState> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { errors: { _form: "Not authorized." } };
  }
  if (!mayManageStanding(membership)) {
    return { errors: { _form: "Recurring invoices aren't part of your access." } };
  }

  const raw = readForm(formData);
  const parsed = SeriesSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "_form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return {
      errors,
      values: Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
      ),
    };
  }

  const read = readLinesAndTax(formData, parsed.data.line_items ?? "", parsed.data.amount_cents);
  if (!read.ok) {
    return { errors: read.errors, values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])) };
  }
  const lineItems = read.lineItems;

  if (!(await isOwnClient(supabase, membership.organization_id, parsed.data.client_id))) {
    return {
      errors: { client_id: "Pick one of your clients." },
      values: Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
      ),
    };
  }

  const firstRun = await firstRunInstant(parsed.data.next_run_at, membership.organization_id);
  const { data: saved, error } = await (supabase
    .from("invoice_series" as never)
    .update({
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      amount_cents: read.amountCents,
      tax_rate_bps: read.taxRateBps,
      tax_label: read.taxLabel,
      due_days: parsed.data.due_days,
      next_run_at: firstRun,
      // The day of the month this series bills on; later runs aim for it.
      anchor_day: new Date(firstRun).getUTCDate(),
      notes: parsed.data.notes,
      line_items: lineItems,
    } as never)
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    )
    .select("id") as unknown as Promise<{
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  }>);

  if (error) {
    return {
      errors: { _form: error.message },
      values: Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
      ),
    };
  }
  // No row: the series is gone, or it isn't this company's. Say so instead
  // of going back to the list as if it had saved.
  if (!saved?.length) {
    return {
      errors: { _form: "This recurring invoice wasn't saved. It may have been deleted." },
      values: Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
      ),
    };
  }

  revalidatePath("/app/settings/recurring-invoices");
  revalidatePath(`/app/settings/recurring-invoices/${id}`);
  redirect("/app/settings/recurring-invoices");
}

export async function toggleRecurringInvoiceAction(formData: FormData) {
  const { membership, supabase } = await getActionContext();
  if (!mayManageStanding(membership)) return;

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  // Resuming: bill from here on, not for the time it was paused. A paused
  // series keeps its old next date, so on resume the nightly job used to
  // make one invoice a night for every period missed. The next date moves
  // forward, on the series' own rhythm, to the first one not in the past.
  const patch: Record<string, unknown> = { active: !active };
  if (!active) {
    const { data: row } = (await supabase
      .from("invoice_series" as never)
      .select("next_run_at, cadence, anchor_day")
      .eq("id" as never, id as never)
      .eq("organization_id" as never, membership.organization_id as never)
      .maybeSingle()) as unknown as {
      data: { next_run_at: string; cadence: string; anchor_day: number | null } | null;
    };
    if (row) {
      const { firstInvoiceRunFrom } = await import("@/lib/invoice-series-dates");
      const current = new Date(row.next_run_at);
      const anchorDay = row.anchor_day ?? current.getUTCDate();
      const resumed = firstInvoiceRunFrom(current, row.cadence, anchorDay, new Date());
      if (resumed.getTime() !== current.getTime()) {
        patch.next_run_at = resumed.toISOString();
        patch.anchor_day = anchorDay;
      }
    }
  }

  await (supabase
    .from("invoice_series" as never)
    .update(patch as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  revalidatePath("/app/settings/recurring-invoices");
}

export async function deleteRecurringInvoiceAction(formData: FormData) {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await (supabase
    .from("invoice_series" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    ) as unknown as Promise<unknown>);

  revalidatePath("/app/settings/recurring-invoices");
}
