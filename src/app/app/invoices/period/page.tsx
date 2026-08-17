import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { bookingLineLabel } from "@/lib/invoice-line-label";
import { centsToDollarString } from "@/lib/validators/common";
import { humanizeEnum } from "@/lib/format";
import { fetchInvoiceFormOptions } from "../options";
import {
  PeriodInvoiceEditor,
  type InitialLine,
  type BilledElsewhere,
} from "./period-invoice-editor";

export const metadata = { title: "Bill for a period" };

export default async function PeriodInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; from?: string; to?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const { client_id, from, to } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const tz = await getOrgTimezone(membership.organization_id);
  const { clients } = await fetchInvoiceFormOptions();

  const validRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(to ?? "");
  const loaded = Boolean(client_id && validRange);

  let lines: InitialLine[] = [];
  let alreadyBilled: BilledElsewhere[] = [];
  let count = 0;
  if (loaded) {
    // Candidate bookings for the client in the date range (not cancelled).
    const { data: bookings } = (await supabase
      .from("bookings")
      .select(
        "id, scheduled_at, service_type, service_type_label, total_cents, address, duration_minutes, property:client_properties ( label ), client:clients ( address )",
      )
      .eq("client_id", client_id as string)
      .gte("scheduled_at", `${from}T00:00:00`)
      .lte("scheduled_at", `${to}T23:59:59.999`)
      .neq("status", "cancelled")
      .is("archived_at" as never, null as never)
      .order("scheduled_at", { ascending: true })) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        total_cents: number | null;
        address: string | null;
        duration_minutes: number | null;
        client: { address: string | null } | null;
      }> | null;
    };

    const candidates = bookings ?? [];
    const candidateIds = candidates.map((b) => b.id);

    // Exclude bookings already billed — either as a single-booking invoice
    // (invoices.booking_id) or on a prior consolidated one
    // (invoice_line_items.booking_id) — ignoring voided invoices.
    // booking id → the invoice already billing it. Details, not a bare set:
    // silently dropping those bookings is what made a period invoice come
    // back short with nothing on screen to explain it. The owner needs to
    // SEE which jobs are spoken for, and by which invoice, to decide whether
    // to fold a stray draft in or leave a sent one alone.
    const billedBy = new Map<
      string,
      { id: string; number: number | null; status: string; amountCents: number }
    >();
    const noteBilled = (
      bookingId: string | null | undefined,
      inv: {
        id: string;
        number: number | null;
        status: string;
        amount_cents: number | null;
      } | null,
    ) => {
      if (!bookingId || !inv || inv.status === "void") return;
      if (billedBy.has(bookingId)) return; // first one found wins
      billedBy.set(bookingId, {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountCents: inv.amount_cents ?? 0,
      });
    };

    if (candidateIds.length > 0) {
      const { data: invRows } = (await supabase
        .from("invoices")
        .select("id, number, status, amount_cents, booking_id")
        .neq("status", "void")
        .in("booking_id", candidateIds)) as unknown as {
        data: Array<{
          id: string;
          number: number | null;
          status: string;
          amount_cents: number | null;
          booking_id: string | null;
        }> | null;
      };
      for (const r of invRows ?? []) {
        noteBilled(r.booking_id, {
          id: r.id,
          number: r.number,
          status: r.status,
          amount_cents: r.amount_cents,
        });
      }

      const { data: liRows } = (await supabase
        .from("invoice_line_items")
        .select(
          "booking_id, invoice:invoices!inner ( id, number, status, amount_cents )",
        )
        .in("booking_id" as never, candidateIds as never)) as unknown as {
        data: Array<{
          booking_id: string | null;
          invoice: {
            id: string;
            number: number | null;
            status: string;
            amount_cents: number | null;
          } | null;
        }> | null;
      };
      for (const r of liRows ?? []) noteBilled(r.booking_id, r.invoice);

      // Third signal: the booking's own stamp. The two above both hang off
      // invoice_line_items.booking_id, so they agree — and they were BOTH
      // blind wherever that link had been stripped by an invoice edit (the
      // defect fixed alongside this). The stamp is written independently by
      // the consolidated builder and the billing-cycle cron, so reading it
      // too means one lost link no longer makes a job look unbilled and
      // invite a second invoice.
      const { data: stamped } = (await supabase
        .from("bookings")
        .select(
          "id, invoice:invoices!bookings_billing_invoice_id_fkey ( id, number, status, amount_cents )",
        )
        .in("id", candidateIds)
        .not("billing_invoice_id", "is", null)) as unknown as {
        data: Array<{
          id: string;
          invoice: {
            id: string;
            number: number | null;
            status: string;
            amount_cents: number | null;
          } | null;
        }> | null;
      };
      for (const r of stamped ?? []) noteBilled(r.id, r.invoice);
    }

    const lineFor = (b: (typeof candidates)[number]) => ({
      label: bookingLineLabel({
        serviceLabel: b.service_type_label ?? humanizeEnum(b.service_type),
        scheduledAt: b.scheduled_at,
        durationMinutes: b.duration_minutes ?? null,
        address: b.address ?? null,
        propertyLabel:
          (b as { property?: { label?: string } | null }).property?.label ??
          null,
        fallbackAddress: b.client?.address ?? null,
        tz,
      }),
      quantity: "1",
      unitPriceDollars:
        b.total_cents != null ? centsToDollarString(b.total_cents) : "",
      bookingId: b.id,
    });

    // Already spoken for. A DRAFT can be folded into this invoice — nobody
    // has seen it — and doing so voids it, which is the whole point: one
    // invoice instead of five. A SENT or PAID one cannot be quietly absorbed;
    // the client already has it, so it is shown and left alone.
    alreadyBilled = candidates
      .filter((b) => billedBy.has(b.id))
      .map((b) => {
        const inv = billedBy.get(b.id)!;
        return {
          ...lineFor(b),
          scheduledAt: b.scheduled_at,
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          invoiceStatus: inv.status,
          invoiceAmountCents: inv.amountCents,
          canConsolidate: inv.status === "draft",
        };
      });

    const unbilled = candidates.filter((b) => !billedBy.has(b.id));
    count = unbilled.length;
    lines = unbilled.map((b) => ({
      // Same helper the two automatic paths use, so a client sees one
      // consistent line format however the invoice was raised. (The old
      // string also appended a literal " clean", giving "Deep clean clean".)
      label: bookingLineLabel({
        serviceLabel: b.service_type_label ?? humanizeEnum(b.service_type),
        scheduledAt: b.scheduled_at,
        durationMinutes: b.duration_minutes ?? null,
        address: b.address ?? null,
        propertyLabel: (b as { property?: { label?: string } | null }).property?.label ?? null,
        fallbackAddress: b.client?.address ?? null,
        tz,
      }),
      quantity: "1",
      unitPriceDollars:
        b.total_cents != null ? centsToDollarString(b.total_cents) : "",
      bookingId: b.id,
    }));
  }

  return (
    <PageShell
      title="Bill for a period"
      description="Pull a client's bookings from a date range onto one invoice."
      actions={
        <Link
          href="/app/invoices"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
      }
    >
      <div className="max-w-3xl space-y-6">
        {/* Period picker */}
        <form
          method="GET"
          className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">Client</span>
            <select
              name="client_id"
              defaultValue={client_id ?? ""}
              required
              className="h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">From</span>
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              required
              className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">To</span>
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              required
              className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </label>
          <button
            type="submit"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <CalendarRange className="h-4 w-4" />
            Load bookings
          </button>
        </form>

        {/* Editor */}
        {loaded ? (
          count === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
              <p className="text-sm font-medium">
                No un-billed bookings in this range
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every booking for this client in that window is either
                cancelled or already on an invoice. Try a different range, or
                add lines manually below.
              </p>
              <div className="mt-4 text-left">
                <PeriodInvoiceEditor
                  clientId={client_id as string}
                  initialLines={[]}
                  alreadyBilled={alreadyBilled}
                  currency={currency}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-4 text-sm text-muted-foreground">
                Pulled <strong className="text-foreground">{count}</strong>{" "}
                booking{count === 1 ? "" : "s"} into the invoice. Edit amounts,
                remove anything you don&rsquo;t want, or add custom lines — then
                create the draft.
              </p>
              <PeriodInvoiceEditor
                clientId={client_id as string}
                initialLines={lines}
                alreadyBilled={alreadyBilled}
                currency={currency}
              />
            </div>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a client and a date range above, then “Load bookings” to build
            the invoice.
          </p>
        )}
      </div>
    </PageShell>
  );
}
