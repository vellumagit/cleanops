"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
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

export async function createRecurringInvoiceAction(
  _prev: RecurringInvoiceState,
  formData: FormData,
): Promise<RecurringInvoiceState> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { errors: { _form: "Not authorized." } };
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

  const { error } = await (supabase
    .from("invoice_series" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      amount_cents: parsed.data.amount_cents,
      due_days: parsed.data.due_days,
      next_run_at: new Date(parsed.data.next_run_at).toISOString(),
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

export async function toggleRecurringInvoiceAction(formData: FormData) {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

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
