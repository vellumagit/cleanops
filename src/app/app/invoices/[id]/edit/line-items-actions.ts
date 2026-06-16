"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionContext, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { parseDollarsToCents } from "@/lib/validators/common";
import { computeTax } from "@/lib/invoice-tax";

const LineItemRowSchema = z.object({
  db_id: z.string().nullable(),
  label: z.string().min(1, "Description is required").max(300),
  quantity: z
    .string()
    .transform((s) => Number(s))
    .refine((n) => Number.isFinite(n) && n > 0, "Qty must be > 0"),
  unit_price_dollars: z
    .string()
    .transform((s) => {
      const c = parseDollarsToCents(s);
      return c;
    })
    .refine((c) => c != null && c > 0, "Price must be > 0"),
  sort_order: z.number(),
});

const LineItemsPayloadSchema = z.array(LineItemRowSchema).min(1, "Add at least one line item");

type Fields = "_form";
export type LineItemsFormState = ActionState<Fields>;

/**
 * Sync line items for an invoice. Strategy:
 *   1. Parse the JSON payload from the hidden input
 *   2. Delete any existing line items that are no longer in the list
 *   3. Upsert the remaining rows (insert new, update changed)
 *   4. Recompute the invoice's `amount_cents` as the sum of line item subtotals
 */
export async function saveLineItemsAction(
  invoiceId: string,
  _prev: LineItemsFormState,
  formData: FormData,
): Promise<LineItemsFormState> {
  const rawJson = formData.get("line_items_json");
  if (!rawJson || typeof rawJson !== "string") {
    return { errors: { _form: "Missing line items data" } };
  }

  let parsed: z.infer<typeof LineItemsPayloadSchema>;
  try {
    const arr = JSON.parse(rawJson);
    const result = LineItemsPayloadSchema.safeParse(arr);
    if (!result.success) {
      const firstError = result.error.issues[0]?.message ?? "Invalid line items";
      return { errors: { _form: firstError } };
    }
    parsed = result.data;
  } catch {
    return { errors: { _form: "Invalid JSON" } };
  }

  const { membership, supabase } = await getActionContext();

  // Verify invoice belongs to org
  const { data: invoice } = (await supabase
    .from("invoices")
    .select("id, organization_id, tax_rate_bps")
    .eq("id", invoiceId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      tax_rate_bps: number | null;
    } | null;
  };

  if (!invoice) {
    return { errors: { _form: "Invoice not found" } };
  }

  // Get existing line item IDs
  const { data: existingItems } = await supabase
    .from("invoice_line_items")
    .select("id")
    .eq("invoice_id", invoiceId);

  const existingIds = new Set((existingItems ?? []).map((r) => r.id));
  const incomingIds = new Set(
    parsed.filter((r) => r.db_id).map((r) => r.db_id!),
  );

  // Delete removed items
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("invoice_line_items")
      .delete()
      .in("id", toDelete);
    if (delErr) {
      return { errors: { _form: delErr.message } };
    }
  }

  // Upsert items (update existing, insert new)
  for (const row of parsed) {
    const payload = {
      invoice_id: invoiceId,
      organization_id: invoice.organization_id,
      label: row.label,
      quantity: row.quantity as number,
      unit_price_cents: row.unit_price_dollars as number, // already converted to cents
      sort_order: row.sort_order,
    };

    if (row.db_id && existingIds.has(row.db_id)) {
      const { error } = await supabase
        .from("invoice_line_items")
        .update(payload)
        .eq("id", row.db_id);
      if (error) return { errors: { _form: error.message } };
    } else {
      const { error } = await supabase
        .from("invoice_line_items")
        .insert(payload);
      if (error) return { errors: { _form: error.message } };
    }
  }

  // Line items are the subtotal; re-apply the invoice's tax on top so the
  // stored total (amount_cents) stays subtotal + tax. Without this, saving
  // line items silently wiped any tax off the invoice and left
  // tax_amount_cents stale — so "adding tax" never changed the total.
  const subtotalCents = parsed.reduce((sum, row) => {
    return sum + Math.round((row.quantity as number) * (row.unit_price_dollars as number));
  }, 0);
  const tax = computeTax(subtotalCents, { rateBps: invoice.tax_rate_bps });

  const { error: updateErr } = await supabase
    .from("invoices")
    .update({
      amount_cents: tax.totalCents,
      tax_amount_cents: tax.taxAmountCents,
    } as never)
    .eq("id", invoiceId);

  if (updateErr) {
    return { errors: { _form: updateErr.message } };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "invoice",
    entity_id: invoiceId,
    after: {
      line_items_count: parsed.length,
      amount_cents: tax.totalCents,
      tax_amount_cents: tax.taxAmountCents,
    },
  });

  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath(`/app/invoices/${invoiceId}/edit`);
  revalidatePath("/app/invoices");
  return {};
}
