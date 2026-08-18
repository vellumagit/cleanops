import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Is this job already on an invoice?" — asked once, in one place.
 *
 * This rule was written inline on the period-invoice screen, and the whole
 * reason it needs extracting is that a SECOND copy is how the Khual invoice
 * went wrong: two screens disagreeing about whether a job was billed is
 * exactly how a client gets charged twice, or never. Any new screen that wants
 * to know must call this rather than re-deriving it.
 *
 * THREE SIGNALS, because each one alone has a blind spot:
 *   1. invoices.booking_id          — single-booking invoices
 *   2. invoice_line_items.booking_id — consolidated invoices
 *   3. bookings.billing_invoice_id  — the stamp
 *
 * 1 and 2 both hang off the line-item link, so they were both blind wherever
 * an invoice edit had stripped it (fixed in 22e71c9, but historical rows still
 * carry the damage). The stamp is written independently by the consolidated
 * builder and the billing-cycle cron, so reading it too means one lost link no
 * longer makes a billed job look free and invite a duplicate.
 *
 * Voided invoices never count — voiding is precisely how you free a job to be
 * billed again.
 */

export type BilledBy = {
  id: string;
  number: number | null;
  status: string;
  amountCents: number;
};

type Invoiceish = {
  id: string;
  number: number | null;
  status: string;
  amount_cents: number | null;
} | null;

/**
 * Pure merge step, extracted so the precedence rule is testable without a
 * database: first writer wins, voids are ignored, nulls are skipped.
 */
export function noteBilled(
  into: Map<string, BilledBy>,
  bookingId: string | null | undefined,
  inv: Invoiceish,
): void {
  if (!bookingId || !inv || inv.status === "void") return;
  if (into.has(bookingId)) return; // first one found wins
  into.set(bookingId, {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    amountCents: inv.amount_cents ?? 0,
  });
}

/** booking id → the invoice already billing it. Absent means unbilled. */
export async function resolveBilledBookings(
  supabase: SupabaseClient,
  bookingIds: readonly string[],
): Promise<Map<string, BilledBy>> {
  const billedBy = new Map<string, BilledBy>();
  if (bookingIds.length === 0) return billedBy;
  const ids = [...bookingIds];

  const [invRes, liRes, stampRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, status, amount_cents, booking_id")
      .neq("status", "void")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<{
        id: string;
        number: number | null;
        status: string;
        amount_cents: number | null;
        booking_id: string | null;
      }> | null;
    }>,
    supabase
      .from("invoice_line_items")
      .select("booking_id, invoice:invoices!inner ( id, number, status, amount_cents )")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<{ booking_id: string | null; invoice: Invoiceish }> | null;
    }>,
    supabase
      .from("bookings")
      .select("id, invoice:invoices!bookings_billing_invoice_id_fkey ( id, number, status, amount_cents )")
      .in("id", ids)
      .not("billing_invoice_id", "is", null) as unknown as Promise<{
      data: Array<{ id: string; invoice: Invoiceish }> | null;
    }>,
  ]);

  for (const r of invRes.data ?? []) {
    noteBilled(billedBy, r.booking_id, {
      id: r.id,
      number: r.number,
      status: r.status,
      amount_cents: r.amount_cents,
    });
  }
  for (const r of liRes.data ?? []) noteBilled(billedBy, r.booking_id, r.invoice);
  for (const r of stampRes.data ?? []) noteBilled(billedBy, r.id, r.invoice);

  return billedBy;
}

export type UnbilledBooking = {
  id: string;
  scheduled_at: string;
  service_type: string;
  service_type_label: string | null;
  total_cents: number | null;
  duration_minutes: number | null;
};

/**
 * A client's completed-but-unbilled work.
 *
 * COMPLETED only. Invoicing a job nobody has done yet is the wrong end of a
 * mistake to discover, and it's the same reason the booking detail page won't
 * draft an invoice until a job is finished.
 */
export async function getUnbilledCompletedBookings(
  supabase: SupabaseClient,
  clientId: string,
  limit = 100,
): Promise<UnbilledBooking[]> {
  const { data: bookings } = (await supabase
    .from("bookings")
    .select(
      "id, scheduled_at, service_type, service_type_label, total_cents, duration_minutes",
    )
    .eq("client_id", clientId)
    .eq("status", "completed")
    .order("scheduled_at", { ascending: true })
    .limit(limit)) as unknown as { data: UnbilledBooking[] | null };

  const candidates = bookings ?? [];
  if (candidates.length === 0) return [];

  const billed = await resolveBilledBookings(
    supabase,
    candidates.map((b) => b.id),
  );
  return candidates.filter((b) => !billed.has(b.id));
}
