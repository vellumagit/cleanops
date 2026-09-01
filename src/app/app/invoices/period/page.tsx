import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedMidnightUtc } from "@/lib/wall-clock";
import { bookingLineLabel } from "@/lib/invoice-line-label";
import { resolveBilledBookings } from "@/lib/billed-bookings";
import { centsToDollarString } from "@/lib/validators/common";
import { humanizeEnum } from "@/lib/format";
import { fetchInvoiceFormOptions } from "../options";
import {
  PeriodInvoiceEditor,
  type InitialLine,
  type BilledElsewhere,
} from "./period-invoice-editor";

export const metadata = { title: "Bill for a period" };

/** The calendar day after a YYYY-MM-DD, for an exclusive upper bound. */
function nextYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

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
      // Org-local day bounds, NOT bare timestamps. `${from}T00:00:00` has no
      // zone, so PostgREST reads it as UTC — and an Edmonton 8 PM job on the
      // period's last day lives at 2 AM UTC the NEXT day, silently dropped
      // from the batch. This is the screen Svitlana builds period invoices
      // on; a job it drops is a job that never gets billed.
      .gte("scheduled_at", zonedMidnightUtc(from as string, tz).toISOString())
      .lt("scheduled_at", zonedMidnightUtc(nextYmd(to as string), tz).toISOString())
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

    // Which of these are already spoken for. THE shared rule — see
    // src/lib/billed-bookings.ts. It used to live inline here, and a second
    // copy of "is this job billed" is exactly how a client gets charged twice
    // or never, so any screen asking the question calls that helper.
    //
    // Details, not a bare set: silently dropping billed bookings is what made
    // a period invoice come back short with nothing on screen to explain it.
    // The owner needs to SEE which jobs are spoken for, and by which invoice,
    // to decide whether to fold a stray draft in or leave a sent one alone.
    const billedBy = await resolveBilledBookings(supabase, candidateIds);

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
              {/* Two very different situations wore the same headline. When
                  drafts exist to fold in, "No un-billed bookings" reads as a
                  dead end — the owner backs out, or deletes the drafts by
                  hand to force the jobs back into the list. Say which case
                  this is, and point at the control that finishes the job. */}
              <p className="text-sm font-medium">
                {alreadyBilled.some((b) => b.canConsolidate)
                  ? "Every job in this range already has a draft invoice"
                  : "No un-billed bookings in this range"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {alreadyBilled.some((b) => b.canConsolidate)
                  ? "That's normal — one is drafted per job as it finishes. Tick the ones below to combine them into a single invoice; their drafts are voided so nothing is billed twice."
                  : "Every booking for this client in that window is either cancelled or already on an invoice. Try a different range, or add lines manually below."}
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
