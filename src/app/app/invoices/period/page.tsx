import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { centsToDollarString } from "@/lib/validators/common";
import { formatDate, humanizeEnum } from "@/lib/format";
import { fetchInvoiceFormOptions } from "../options";
import { PeriodInvoiceEditor, type InitialLine } from "./period-invoice-editor";

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
  let count = 0;
  if (loaded) {
    // Candidate bookings for the client in the date range (not cancelled).
    const { data: bookings } = (await supabase
      .from("bookings")
      .select("id, scheduled_at, service_type, total_cents")
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
        total_cents: number | null;
      }> | null;
    };

    const candidates = bookings ?? [];
    const candidateIds = candidates.map((b) => b.id);

    // Exclude bookings already billed — either as a single-booking invoice
    // (invoices.booking_id) or on a prior consolidated one
    // (invoice_line_items.booking_id) — ignoring voided invoices.
    const billed = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: invRows } = (await supabase
        .from("invoices")
        .select("booking_id")
        .neq("status", "void")
        .in("booking_id", candidateIds)) as unknown as {
        data: Array<{ booking_id: string | null }> | null;
      };
      for (const r of invRows ?? []) {
        if (r.booking_id) billed.add(r.booking_id);
      }

      const { data: liRows } = (await supabase
        .from("invoice_line_items")
        .select("booking_id, invoice:invoices!inner ( status )")
        .in("booking_id" as never, candidateIds as never)) as unknown as {
        data: Array<{
          booking_id: string | null;
          invoice: { status: string } | null;
        }> | null;
      };
      for (const r of liRows ?? []) {
        if (r.booking_id && r.invoice?.status !== "void") billed.add(r.booking_id);
      }
    }

    const unbilled = candidates.filter((b) => !billed.has(b.id));
    count = unbilled.length;
    lines = unbilled.map((b) => ({
      label: `${humanizeEnum(b.service_type)} clean — ${formatDate(b.scheduled_at, tz)}`,
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
