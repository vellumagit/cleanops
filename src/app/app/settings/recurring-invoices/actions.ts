"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { can } from "@/lib/auth";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { z } from "zod";

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
    line_items: String(formData.get("line_items") ?? "").trim(),
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

  let lineItems: unknown = [];
  if (parsed.data.line_items) {
    try {
      lineItems = JSON.parse(parsed.data.line_items);
      if (!Array.isArray(lineItems)) {
        return {
          errors: { line_items: "Line items must be a JSON array" },
          values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])),
        };
      }
    } catch {
      return {
        errors: { line_items: "Line items is not valid JSON" },
        values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])),
      };
    }
  }

  if (!(await isOwnClient(supabase, membership.organization_id, parsed.data.client_id))) {
    return {
      errors: { client_id: "Pick one of your clients." },
      values: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])),
    };
  }

  const { error } = await (supabase
    .from("invoice_series" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      amount_cents: parsed.data.amount_cents,
      due_days: parsed.data.due_days,
      next_run_at: await firstRunInstant(parsed.data.next_run_at, membership.organization_id),
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

  let lineItems: unknown = [];
  if (parsed.data.line_items) {
    try {
      lineItems = JSON.parse(parsed.data.line_items);
      if (!Array.isArray(lineItems)) {
        return {
          errors: { line_items: "Line items must be a JSON array" },
          values: Object.fromEntries(
            Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
          ),
        };
      }
    } catch {
      return {
        errors: { line_items: "Line items is not valid JSON" },
        values: Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
        ),
      };
    }
  }

  if (!(await isOwnClient(supabase, membership.organization_id, parsed.data.client_id))) {
    return {
      errors: { client_id: "Pick one of your clients." },
      values: Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, String(v ?? "")]),
      ),
    };
  }

  const { data: saved, error } = await (supabase
    .from("invoice_series" as never)
    .update({
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      amount_cents: parsed.data.amount_cents,
      due_days: parsed.data.due_days,
      next_run_at: await firstRunInstant(parsed.data.next_run_at, membership.organization_id),
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

  await (supabase
    .from("invoice_series" as never)
    .update({ active: !active } as never)
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
