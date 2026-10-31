import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDollarsToCents } from "@/lib/validators/common";
import { computeTax, parseTaxRate } from "@/lib/invoice-tax";
import { matchLineToJob, resolveBilledBookings } from "@/lib/billed-bookings";
import { getOrgTimezone } from "@/lib/org-timezone";

/**
 * Line-item reconciliation, extracted from the old standalone
 * "Save line items" action so the ONE invoice save can run it inline —
 * Brian: "it should always be one entire invoice that I'm editing."
 *
 * Strategy unchanged: delete rows missing from the payload, upsert the
 * rest, recompute subtotal + tax. booking_id is round-tripped on every
 * insert — that link is the only record that a job on a consolidated
 * invoice has been billed, and omitting it once double-billed a job.
 */

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
  /** The job this line bills. Round-tripped, never entered by hand. */
  booking_id: z.string().nullable().optional(),
});

const LineItemsPayloadSchema = z
  .array(LineItemRowSchema)
  .min(1, "Add at least one line item");

export type ReconcileResult =
  | {
      ok: true;
      itemCount: number;
      totalCents: number;
      taxAmountCents: number | null;
      taxRateBps: number | null;
      taxLabel: string | null;
    }
  | { ok: false; error: string };

/**
 * Parse the editor's hidden payload + tax fields off `formData`, sync
 * invoice_line_items, and return the recomputed money columns for the
 * caller to write onto the invoice (the caller owns the invoices UPDATE
 * so the whole save stays one write with one status computation).
 */
export async function reconcileInvoiceLineItems(
  supabase: SupabaseClient,
  invoice: {
    id: string;
    organization_id: string;
    tax_rate_bps: number | null;
    tax_label: string | null;
  },
  formData: FormData,
): Promise<ReconcileResult> {
  const rawJson = formData.get("line_items_json");
  if (!rawJson || typeof rawJson !== "string") {
    return { ok: false, error: "Missing line items data" };
  }

  let parsed: z.infer<typeof LineItemsPayloadSchema>;
  try {
    const arr = JSON.parse(rawJson);
    const result = LineItemsPayloadSchema.safeParse(arr);
    if (!result.success) {
      return {
        ok: false,
        error: result.error.issues[0]?.message ?? "Invalid line items",
      };
    }
    parsed = result.data;
  } catch {
    return { ok: false, error: "Invalid line items payload" };
  }

  const { data: existingItems } = await supabase
    .from("invoice_line_items")
    .select("id")
    .eq("invoice_id", invoice.id);

  const existingIds = new Set((existingItems ?? []).map((r) => r.id));
  const incomingIds = new Set(
    parsed.filter((r) => r.db_id).map((r) => r.db_id!),
  );

  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("invoice_line_items")
      .delete()
      .in("id", toDelete);
    if (delErr) return { ok: false, error: delErr.message };
  }

  await linkHandAddedLines(supabase, invoice, parsed);

  for (const row of parsed) {
    const payload = {
      invoice_id: invoice.id,
      organization_id: invoice.organization_id,
      label: row.label,
      quantity: row.quantity as number,
      unit_price_cents: row.unit_price_dollars as number, // already cents
      sort_order: row.sort_order,
      // MUST be written on the INSERT branch — see header comment.
      booking_id: row.booking_id ?? null,
    };

    if (row.db_id && existingIds.has(row.db_id)) {
      const { error } = await supabase
        .from("invoice_line_items")
        .update(payload)
        .eq("id", row.db_id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase
        .from("invoice_line_items")
        .insert(payload);
      if (error) return { ok: false, error: error.message };
    }
  }

  // The stamp is what the billing run reads, and an edited invoice never set
  // it: the line said billed and the job said not. Guarded on still-null so a
  // job billed elsewhere is never re-pointed here.
  const billedIds = [
    ...new Set(parsed.map((r) => r.booking_id).filter((id): id is string => !!id)),
  ];
  if (billedIds.length > 0) {
    const { error: stampErr } = await supabase
      .from("bookings")
      .update({ billing_invoice_id: invoice.id } as never)
      .in("id", billedIds)
      .eq("organization_id", invoice.organization_id)
      .is("billing_invoice_id" as never, null as never);
    if (stampErr) {
      console.error(
        `[invoices] invoice ${invoice.id}: billing stamp failed (lines still saved):`,
        stampErr.message,
      );
    }
  }

  // Line items are the subtotal; tax comes from the same form. Falls back
  // to the invoice's saved rate only if the form didn't submit tax fields.
  const subtotalCents = parsed.reduce((sum, row) => {
    return (
      sum + Math.round((row.quantity as number) * (row.unit_price_dollars as number))
    );
  }, 0);

  const rawRate = formData.get("items_tax_rate_percent");
  const rawLabel = formData.get("items_tax_label");
  const rateBps =
    rawRate !== null
      ? parseTaxRate(typeof rawRate === "string" ? rawRate : "")
      : invoice.tax_rate_bps;
  const tax = computeTax(subtotalCents, { rateBps });
  // SUBMITTED-BUT-EMPTY means the owner cleared the label, and must not
  // fall back to the saved one — blanking "GST" on a taxed invoice used to
  // write "GST" straight back onto the client-facing document. Only a field
  // the form never sent at all (a stale client predating the merged save)
  // falls back to what's stored.
  const taxLabel =
    tax.rateBps && tax.rateBps > 0
      ? (typeof rawLabel === "string" ? rawLabel.trim() : invoice.tax_label) ||
        null
      : null;

  return {
    ok: true,
    itemCount: parsed.length,
    totalCents: tax.totalCents,
    taxAmountCents: tax.taxAmountCents,
    taxRateBps: tax.rateBps,
    taxLabel,
  };
}

/**
 * Give a line added by hand its job, when there is exactly one it can be. See
 * matchLineToJob. Sets booking_id on the rows in place. Best effort: a line
 * that can't be linked saves exactly as typed, and a failed read must never
 * stop someone saving an invoice.
 */
async function linkHandAddedLines(
  supabase: SupabaseClient,
  invoice: { id: string; organization_id: string },
  rows: Array<{
    label: string;
    quantity: number;
    unit_price_dollars: number | null;
    booking_id?: string | null;
  }>,
): Promise<void> {
  const unlinked = rows.filter((r) => !r.booking_id);
  if (unlinked.length === 0) return;
  try {
    const { data: inv } = (await supabase
      .from("invoices")
      .select("client_id")
      .eq("id", invoice.id)
      .maybeSingle()) as unknown as { data: { client_id: string | null } | null };
    if (!inv?.client_id) return;

    const { data: jobs, error } = (await supabase
      .from("bookings")
      .select("id, scheduled_at, total_cents")
      .eq("client_id", inv.client_id)
      .eq("organization_id", invoice.organization_id)
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(500)) as unknown as {
      data: Array<{ id: string; scheduled_at: string; total_cents: number | null }> | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    const candidates = jobs ?? [];
    if (candidates.length === 0) return;

    const billedBy = await resolveBilledBookings(
      supabase,
      candidates.map((j) => j.id),
      { failClosed: true },
    );
    const taken = new Set(rows.map((r) => r.booking_id).filter(Boolean));
    let open = candidates.filter((j) => {
      if (taken.has(j.id)) return false;
      const by = billedBy.get(j.id);
      return !by || by.id === invoice.id;
    });
    const tz = await getOrgTimezone(invoice.organization_id);
    for (const row of unlinked) {
      const jobId = matchLineToJob(
        {
          label: row.label,
          quantity: row.quantity,
          unit_price_cents: row.unit_price_dollars ?? 0,
        },
        open,
        tz,
      );
      if (!jobId) continue;
      row.booking_id = jobId;
      open = open.filter((j) => j.id !== jobId);
    }
  } catch (err) {
    console.error(`[invoices] invoice ${invoice.id}: could not link hand-added lines:`, err);
  }
}
