/**
 * Cron: Billing-cycle invoice generation
 *
 * Runs on the 1st AND 15th of every month at 07:00 UTC.
 *   - On the 1st:  generates invoices for `monthly` AND `biweekly` clients.
 *   - On the 15th: generates invoices for `biweekly` clients only.
 *
 * For each eligible client the cron collects all bookings that:
 *   1. Belong to that client.
 *   2. Have billing_invoice_id IS NULL (not yet billed).
 *   3. Scheduled before the cron run date (period closes at midnight UTC
 *      on the cron date — jobs scheduled today are included next cycle).
 *   4. Status is `completed` (itemized) or `completed | cancelled` (flat_rate,
 *      where cancelled jobs still consume the retainer period).
 *
 * If zero unbilled bookings are found the client is silently skipped.
 *
 * billing_type = itemized
 *   One invoice line item per completed booking.
 *   Cancelled bookings are excluded entirely.
 *   Invoice amount = sum of booking total_cents (+ org default tax).
 *
 * billing_type = flat_rate
 *   One invoice line item: "Monthly retainer — <period>" at flat_rate_cents.
 *   All bookings (completed AND cancelled) are listed in the invoice notes.
 *   Invoice amount = flat_rate_cents (+ org default tax).
 *   If flat_rate_cents is NULL the booking totals are summed as a fallback
 *   (same as itemized) — this prevents a $0 invoice when the owner forgot
 *   to set the rate.
 *
 * After the invoice is created every included booking gets its
 * billing_invoice_id stamped so the next run skips them.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCronAuth } from "@/lib/cron-auth";
import { humanizeEnum } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrgMeta = {
  id: string;
  name: string;
  default_tax_rate_bps: number | null;
  default_tax_label: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  billing_cadence: "on_demand" | "biweekly" | "monthly";
  billing_type: "itemized" | "flat_rate";
  flat_rate_cents: number | null;
  organization_id: string;
};

type BookingRow = {
  id: string;
  status: string;
  total_cents: number | null;
  service_type: string | null;
  address: string | null;
  scheduled_at: string;
};

type InvoiceRow = {
  id: string;
  number: string | null;
};

// ---------------------------------------------------------------------------
// Helper: human-readable period label ("April 1–14, 2026")
// ---------------------------------------------------------------------------

function periodLabel(runDate: Date, cadence: "biweekly" | "monthly"): string {
  const day = runDate.getUTCDate();
  const year = runDate.getUTCFullYear();
  const monthName = runDate.toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

  if (cadence === "monthly") {
    return `${monthName} ${year}`;
  }

  // biweekly: 1st run covers 16th–last of previous month, 15th run covers 1st–14th
  if (day === 1) {
    // Period: 16th to last day of the previous month
    const prevMonth = new Date(
      Date.UTC(year, runDate.getUTCMonth() - 1, 1),
    );
    const prevMonthName = prevMonth.toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    const lastDay = new Date(
      Date.UTC(year, runDate.getUTCMonth(), 0),
    ).getUTCDate();
    return `${prevMonthName} 16–${lastDay}, ${prevMonth.getUTCFullYear()}`;
  }
  // day === 15: period is 1st to 14th of current month
  return `${monthName} 1–14, ${year}`;
}

// ---------------------------------------------------------------------------
// Helper: apply org-level default tax to a subtotal
// ---------------------------------------------------------------------------

function applyTax(
  subtotalCents: number,
  rateBps: number | null,
): { totalCents: number; taxAmountCents: number } {
  if (!rateBps || rateBps <= 0) {
    return { totalCents: subtotalCents, taxAmountCents: 0 };
  }
  const taxAmountCents = Math.round((subtotalCents * rateBps) / 10000);
  return { totalCents: subtotalCents + taxAmountCents, taxAmountCents };
}

// ---------------------------------------------------------------------------
// Core: generate one consolidated invoice for a client
// Returns the invoice id or null on skip/failure
// ---------------------------------------------------------------------------

async function generateClientInvoice(
  db: ReturnType<typeof createSupabaseAdminClient>,
  client: ClientRow,
  org: OrgMeta,
  runDate: Date,
): Promise<{ invoiceId: string; number: string | null } | null> {
  const cadence = client.billing_cadence;
  if (cadence === "on_demand") return null; // shouldn't be called, guard anyway

  // Cutoff: bookings scheduled strictly before midnight UTC on the cron date.
  const cutoff = runDate.toISOString().split("T")[0]; // "YYYY-MM-DD"

  // ── Fetch unbilled bookings ──────────────────────────────────────────────
  const { data: bookingsRaw } = (await db
    .from("bookings")
    .select("id, status, total_cents, service_type, address, scheduled_at")
    .eq("client_id", client.id)
    .is("billing_invoice_id", null)
    .lt("scheduled_at", cutoff)
    .in(
      "status",
      client.billing_type === "flat_rate"
        ? ["completed", "cancelled"]
        : ["completed"],
    )
    .order("scheduled_at", { ascending: true })) as unknown as {
    data: BookingRow[] | null;
  };

  const bookings = bookingsRaw ?? [];

  if (bookings.length === 0) {
    // Nothing to bill — skip silently.
    return null;
  }

  // ── Compute amounts ──────────────────────────────────────────────────────
  const completedBookings = bookings.filter((b) => b.status === "completed");
  const period = periodLabel(runDate, cadence);

  let subtotalCents: number;
  let lineItemLabel: string;
  let invoiceNotes: string | null = null;

  if (client.billing_type === "flat_rate") {
    // Use the configured flat rate, or fall back to sum of booking totals.
    subtotalCents =
      client.flat_rate_cents ??
      completedBookings.reduce((s, b) => s + (b.total_cents ?? 0), 0);
    lineItemLabel = `Retainer — ${period}`;

    // Build notes: list all bookings so the client can see what was covered.
    const lines = bookings.map((b) => {
      const date = new Date(b.scheduled_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      const svc = b.service_type ? humanizeEnum(b.service_type) : "Service";
      const status = b.status === "cancelled" ? " (cancelled)" : "";
      return `• ${date} — ${svc}${b.address ? ` @ ${b.address}` : ""}${status}`;
    });
    invoiceNotes = `Services covered this period:\n${lines.join("\n")}`;
  } else {
    // Itemized: sum completed bookings only
    subtotalCents = completedBookings.reduce(
      (s, b) => s + (b.total_cents ?? 0),
      0,
    );
    lineItemLabel = `Services — ${period}`;
  }

  const tax = applyTax(subtotalCents, org.default_tax_rate_bps);

  // Due date: net 14 from today
  const dueDate = new Date(runDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + 14);
  const dueDateStr = dueDate.toISOString().split("T")[0];

  // ── Create invoice ───────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = (await db
    .from("invoices")
    .insert({
      organization_id: org.id,
      client_id: client.id,
      status: "draft",
      amount_cents: tax.totalCents,
      ...(org.default_tax_rate_bps && org.default_tax_rate_bps > 0
        ? {
            tax_rate_bps: org.default_tax_rate_bps,
            tax_amount_cents: tax.taxAmountCents,
            tax_label: org.default_tax_label ?? null,
          }
        : {}),
      due_date: dueDateStr,
      ...(invoiceNotes ? { notes: invoiceNotes } : {}),
    } as never)
    .select("id, number")
    .single()) as unknown as {
    data: InvoiceRow | null;
    error: { message: string } | null;
  };

  if (invErr || !invoice) {
    console.error(
      `[billing-cycle] invoice insert failed for client ${client.id}:`,
      invErr?.message,
    );
    return null;
  }

  // ── Create line items ────────────────────────────────────────────────────
  if (client.billing_type === "flat_rate") {
    // Single retainer line item
    const { error: liErr } = await db.from("invoice_line_items").insert({
      organization_id: org.id,
      invoice_id: invoice.id,
      label: lineItemLabel,
      quantity: 1,
      unit_price_cents: subtotalCents,
      sort_order: 0,
    } as never);

    if (liErr) {
      console.error(
        `[billing-cycle] line item insert failed for invoice ${invoice.id}:`,
        liErr.message,
      );
    }
  } else {
    // One line item per completed booking
    for (let i = 0; i < completedBookings.length; i++) {
      const b = completedBookings[i];
      const date = new Date(b.scheduled_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      const svc = b.service_type ? humanizeEnum(b.service_type) : "Service";
      const label = `${svc} — ${date}${b.address ? ` @ ${b.address}` : ""}`;

      const { error: liErr } = await db.from("invoice_line_items").insert({
        organization_id: org.id,
        invoice_id: invoice.id,
        label,
        quantity: 1,
        unit_price_cents: b.total_cents ?? 0,
        sort_order: i,
      } as never);

      if (liErr) {
        console.error(
          `[billing-cycle] line item insert failed (booking ${b.id}):`,
          liErr.message,
        );
      }
    }
  }

  // ── Stamp billing_invoice_id on all included bookings ───────────────────
  // For flat_rate: stamp both completed AND cancelled.
  // For itemized: stamp only completed (we only fetched those above).
  const bookingIdsToStamp = bookings.map((b) => b.id);

  const { error: stampErr } = await db
    .from("bookings")
    .update({ billing_invoice_id: invoice.id } as never)
    .in("id", bookingIdsToStamp);

  if (stampErr) {
    console.error(
      `[billing-cycle] billing_invoice_id stamp failed for invoice ${invoice.id}:`,
      stampErr.message,
    );
  }

  // Schedule auto-send for consolidated invoices if the org opted in.
  try {
    const { scheduleAutoSendIfEnabled } = await import("@/lib/invoice-send");
    await scheduleAutoSendIfEnabled(invoice.id, org.id, { consolidated: true });
  } catch (scheduleErr) {
    console.error(
      `[billing-cycle] auto-send schedule failed for invoice ${invoice.id} (still drafted):`,
      scheduleErr,
    );
  }

  console.log(
    `[billing-cycle] Invoice ${invoice.number ?? invoice.id} created for client "${client.name}" (${client.billing_type}, ${bookings.length} booking(s))`,
  );

  return { invoiceId: invoice.id, number: invoice.number };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const db = createSupabaseAdminClient();
    const runDate = new Date();
    const dayOfMonth = runDate.getUTCDate();

    // Determine which cadences run today.
    // 1st  → monthly + biweekly
    // 15th → biweekly only
    // Any other day → nothing (cron is scheduled only on 1st and 15th, but
    //   guard here so a manual trigger mid-month is a safe no-op).
    const activeCadences: Array<"biweekly" | "monthly"> = [];
    if (dayOfMonth === 1) {
      activeCadences.push("monthly", "biweekly");
    } else if (dayOfMonth === 15) {
      activeCadences.push("biweekly");
    } else {
      console.log(
        `[billing-cycle] day=${dayOfMonth} — no cadences active today, skipping.`,
      );
      return Response.json({ skipped: true, day: dayOfMonth, invoices: 0 });
    }

    // ── Fetch all orgs (we need their tax config) ──────────────────────────
    // Skip orgs that have been deleted OR are pending deletion — they're
    // not paying customers anymore and shouldn't be generating invoices.
    const { data: orgsRaw } = (await db
      .from("organizations")
      .select(
        "id, name, default_tax_rate_bps, default_tax_label",
      )
      .is("deleted_at", null)
      .is("deletion_scheduled_at", null)) as unknown as {
      data: OrgMeta[] | null;
    };

    const orgs = orgsRaw ?? [];
    const orgMap = new Map<string, OrgMeta>(orgs.map((o) => [o.id, o]));

    // ── Fetch all eligible clients ─────────────────────────────────────────
    // Filter archived clients — they remain in the DB for history but
    // shouldn't generate new invoices.
    const { data: clientsRaw } = (await db
      .from("clients")
      .select(
        "id, name, email, billing_cadence, billing_type, flat_rate_cents, organization_id",
      )
      .in("billing_cadence", activeCadences)
      .is("archived_at" as never, null as never)) as unknown as {
      data: ClientRow[] | null;
    };

    const clients = clientsRaw ?? [];

    let invoicesCreated = 0;
    let clientsSkipped = 0;

    for (const client of clients) {
      const org = orgMap.get(client.organization_id);
      if (!org) {
        console.warn(
          `[billing-cycle] org ${client.organization_id} not found for client ${client.id} — skipping`,
        );
        clientsSkipped++;
        continue;
      }

      const result = await generateClientInvoice(db, client, org, runDate);
      if (result) {
        invoicesCreated++;
      } else {
        clientsSkipped++;
      }
    }

    return Response.json({
      day: dayOfMonth,
      cadences: activeCadences,
      clients_checked: clients.length,
      invoices_created: invoicesCreated,
      clients_skipped: clientsSkipped,
    });
  } catch (err) {
    console.error("[cron/billing-cycle] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
