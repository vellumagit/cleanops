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
 * billed again. By a person: billing_released_at keeps the automatic paths off
 * it (see billableInSweep), so a void doesn't come back on the next run.
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

/**
 * What the billing run may bill: not billed already, by any of the three
 * signals, and not voided off an invoice by a person.
 *
 * The run only ever looked at the stamp. That is how Promotional Wearhouse
 * would have been billed for April to June, which Svitlana voided the day
 * before, and for four visits already on the $882 invoice she had just sent.
 */
export function billableInSweep<
  T extends { id: string; billing_released_at?: string | null },
>(rows: readonly T[], billedBy: ReadonlyMap<string, BilledBy>): T[] {
  return rows.filter((r) => !r.billing_released_at && !billedBy.has(r.id));
}

/**
 * Which job a hand-added invoice line bills, or null if that isn't certain.
 *
 * Someone adding a visit to an invoice types (or pastes) a line with no link
 * to the job, so the job still looks unbilled and the next run bills it again.
 * Linked only when the line names the job's date, in the form every invoice
 * line uses ("Thu, Oct 15, 2026"), the price matches, and exactly one job fits.
 * The time isn't compared: Oct 15's line on INV-2026-0312 says 10:30 for a job
 * moved to 1:30. A guess here could hide work that was never billed, so
 * anything short of one clear match stays unlinked.
 */
export function matchLineToJob(
  line: { label: string; quantity: number; unit_price_cents: number },
  jobs: ReadonlyArray<{ id: string; scheduled_at: string; total_cents: number | null }>,
  tz: string,
): string | null {
  if (line.quantity !== 1) return null;
  const fits = jobs.filter((j) => {
    if (j.total_cents !== line.unit_price_cents) return false;
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(j.scheduled_at));
    return line.label.includes(date);
  });
  return fits.length === 1 ? fits[0].id : null;
}

/**
 * A person voided these invoices: free their jobs, and mark them so only a
 * person bills them again. Finds jobs by all three signals, because older
 * invoices carry a stamp with no line link, or a link with no stamp.
 *
 * Never throws: the invoices are already void by the time this runs.
 */
export async function releaseJobsFromVoidedInvoices(
  supabase: SupabaseClient,
  organizationId: string,
  invoiceIds: readonly string[],
  nowIso: string,
): Promise<void> {
  if (invoiceIds.length === 0) return;
  const ids = [...invoiceIds];
  const [perJob, lines] = await Promise.all([
    supabase.from("invoices").select("booking_id").in("id", ids) as unknown as Promise<{
      data: Array<{ booking_id: string | null }> | null;
      error: { message: string } | null;
    }>,
    supabase.from("invoice_line_items").select("booking_id").in("invoice_id", ids) as unknown as Promise<{
      data: Array<{ booking_id: string | null }> | null;
      error: { message: string } | null;
    }>,
  ]);
  const readErr = perJob.error ?? lines.error;
  if (readErr) {
    console.error("[billing] void: could not read the jobs on these invoices:", readErr.message);
  }

  const { error: stampedErr } = await supabase
    .from("bookings")
    .update({ billing_invoice_id: null, billing_released_at: nowIso } as never)
    .in("billing_invoice_id", ids)
    .eq("organization_id", organizationId);
  if (stampedErr) {
    console.error(`[billing] void: un-stamp failed for ${ids.length} invoice(s):`, stampedErr.message);
  }

  const linked = [
    ...new Set(
      [...(perJob.data ?? []), ...(lines.data ?? [])]
        .map((r) => r.booking_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (linked.length === 0) return;
  // Still stamped means another live invoice bills it, so it stays as it is.
  const { error: linkedErr } = await supabase
    .from("bookings")
    .update({ billing_released_at: nowIso } as never)
    .in("id", linked)
    .eq("organization_id", organizationId)
    .is("billing_invoice_id", null);
  if (linkedErr) {
    console.error(`[billing] void: release failed for ${linked.length} job(s):`, linkedErr.message);
  }
}

/**
 * booking id → the invoice already billing it. Absent means unbilled.
 *
 * `failClosed` throws when a read fails. A screen can show a stale answer; the
 * billing run can't treat "couldn't check" as "not billed", because that is a
 * double bill.
 */
export async function resolveBilledBookings(
  supabase: SupabaseClient,
  bookingIds: readonly string[],
  opts: { failClosed?: boolean } = {},
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
      error?: { message: string } | null;
    }>,
    supabase
      .from("invoice_line_items")
      .select("booking_id, invoice:invoices!inner ( id, number, status, amount_cents )")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<{ booking_id: string | null; invoice: Invoiceish }> | null;
      error?: { message: string } | null;
    }>,
    supabase
      .from("bookings")
      .select("id, invoice:invoices!bookings_billing_invoice_id_fkey ( id, number, status, amount_cents )")
      .in("id", ids)
      .not("billing_invoice_id", "is", null) as unknown as Promise<{
      data: Array<{ id: string; invoice: Invoiceish }> | null;
      error?: { message: string } | null;
    }>,
  ]);
  if (opts.failClosed) {
    const failed = invRes.error ?? liRes.error ?? stampRes.error;
    if (failed) throw new Error(`could not read what is billed: ${failed.message}`);
  }

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
