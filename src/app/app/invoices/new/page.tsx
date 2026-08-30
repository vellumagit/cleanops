import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTaxDefaults, taxRateBpsToPercentString } from "@/lib/org-tax";
import { getOrgTimezone } from "@/lib/org-timezone";
import { PageShell } from "@/components/page-shell";
import { formatDate, formatCurrencyCents, humanizeEnum } from "@/lib/format";
import { centsToDollarString } from "@/lib/validators/common";
import { getUnbilledCompletedBookings } from "@/lib/billed-bookings";
import { InvoiceForm } from "../invoice-form";
import { fetchInvoiceFormOptions } from "../options";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  requireCapability(membership, "invoicing");
  const { client_id } = await searchParams;

  const [{ clients, bookings }, currency, taxDefaults] = await Promise.all([
    fetchInvoiceFormOptions(),
    getOrgCurrency(membership.organization_id),
    getOrgTaxDefaults(membership.organization_id),
  ]);

  // Only honour a client_id the org can actually see. fetchInvoiceFormOptions
  // is already org-scoped by RLS, so checking against it means a hand-typed id
  // from another tenant prefills nothing rather than leaking a name.
  const prefillClient = client_id && clients.some((c) => c.id === client_id)
    ? client_id
    : undefined;

  // What this client still owes an invoice for. The whole reason the page
  // takes a client_id: arriving from a client and being handed a blank form is
  // how July 24 and 31 got left off the Qual invoice.
  const supabase = await createSupabaseServerClient();
  const unbilled = prefillClient
    ? await getUnbilledCompletedBookings(supabase, prefillClient)
    : [];
  const tz = await getOrgTimezone(membership.organization_id);

  // ONE unbilled job is unambiguous — prefill it, amount and all, so the
  // common case is "check it and save". SEVERAL is not a guess worth making:
  // picking one silently would leave the others behind, which is precisely the
  // failure this is meant to prevent. Offer the batch screen instead.
  const only = unbilled.length === 1 ? unbilled[0] : null;

  const clientName = prefillClient
    ? clients.find((c) => c.id === prefillClient)?.label
    : undefined;

  return (
    <PageShell
      title="New invoice"
      description={
        clientName
          ? `Bill ${clientName} for work delivered.`
          : "Bill a client for work delivered."
      }
    >
      <div className="max-w-2xl space-y-4">
        {unbilled.length > 1 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {unbilled.length} completed jobs for {clientName} have no invoice
              linked to them
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-amber-900/90 dark:text-amber-200/90">
              {unbilled.slice(0, 6).map((b) => (
                <li key={b.id} className="flex justify-between gap-3">
                  <span>
                    {formatDate(b.scheduled_at, tz)} &middot;{" "}
                    {b.service_type_label ?? humanizeEnum(b.service_type)}
                  </span>
                  <span className="tabular-nums">
                    {b.total_cents != null
                      ? formatCurrencyCents(b.total_cents, currency)
                      : "—"}
                  </span>
                </li>
              ))}
              {unbilled.length > 6 && (
                <li className="italic">and {unbilled.length - 6} more…</li>
              )}
            </ul>
            <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-200/80">
              This form bills one job. To put several on a single invoice, use
              the period screen &mdash; it lists every job in a date range and
              flags anything already invoiced.
            </p>
            {/* Deliberately says "no invoice LINKED", not "not billed".
                An invoice edit used to strip invoice_line_items.booking_id
                (fixed in 22e71c9, but ~53 historical line items still carry the
                damage), so a job that IS on a sent invoice can appear here.
                Claiming certainty we don't have would send her chasing money
                she has already invoiced. */}
            <p className="mt-1 text-[11px] text-amber-900/70 dark:text-amber-200/70">
              Check before billing &mdash; a job that was invoiced and then had
              that invoice edited can lose its link and show up here.
            </p>
            <Link
              href={`/app/invoices/period?client_id=${prefillClient}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              <CalendarRange className="h-3.5 w-3.5" />
              Bill them together
            </Link>
          </div>
        )}

        {only && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            Filled in from {clientName}&rsquo;s one unbilled job &mdash;{" "}
            <span className="font-medium text-foreground">
              {formatDate(only.scheduled_at, tz)},{" "}
              {only.service_type_label ?? humanizeEnum(only.service_type)}
            </span>
            . Change anything below before saving.
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-6">
          <InvoiceForm
            mode="create"
            clients={clients}
            bookings={bookings}
            currency={currency}
            tz={tz}
            defaults={
              prefillClient
                ? {
                    client_id: prefillClient,
                    // subtotal_DOLLARS — the form takes a dollar string, not
                    // cents. Worth naming: a spread bypasses TypeScript's
                    // excess-property check, so the wrong key here typechecks
                    // clean and silently prefills nothing.
                    ...(only
                      ? {
                          booking_id: only.id,
                          subtotal_dollars:
                            only.total_cents != null
                              ? centsToDollarString(only.total_cents)
                              : undefined,
                        }
                      : {}),
                  }
                : undefined
            }
            orgDefaultTaxRatePercent={taxRateBpsToPercentString(
              taxDefaults.rateBps,
            )}
            orgDefaultTaxLabel={taxDefaults.label ?? ""}
          />
        </div>
      </div>
    </PageShell>
  );
}
