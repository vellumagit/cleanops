import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Ban, ExternalLink, Star } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { StripePaymentLinkButton } from "./stripe-payment-link-button";
import { SendInvoiceButton } from "./send-invoice-button";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  StatusBadge,
  invoiceStatusTone,
  type StatusTone,
} from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDate,
  formatDateTime,
  humanizeEnum,
} from "@/lib/format";
import {
  voidInvoiceAction,
  generateReviewTokenAction,
} from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { RecordPaymentForm } from "./record-payment-form";
import { PaymentRowActions } from "./payment-row-actions";
import { humanizePaymentMethod } from "@/lib/validators/invoice-payment";

export const metadata = { title: "Invoice" };

type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void";

/**
 * Invoice detail page — Phase 12 rework.
 *
 * Shows the invoice header, client, line items (read-only for now — the
 * edit page is still where line items are managed), payment history with
 * a record-payment form, a "Send invoice" action, and a "Void" danger
 * button. The status badge reflects the trigger-computed state, not the
 * form-driven one.
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  // Check Stripe Connect status on the org — payment link only makes sense
  // if the org has charges enabled.
  const admin = createSupabaseAdminClient();
  const { data: orgStripe } = await admin
    .from("organizations")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", membership.organization_id)
    .maybeSingle();
  const stripeReady = Boolean(
    (orgStripe as { stripe_account_id: string | null; stripe_charges_enabled: boolean } | null)
      ?.stripe_account_id &&
      (orgStripe as { stripe_charges_enabled: boolean } | null)?.stripe_charges_enabled,
  );

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      `
        id, number, public_token, status, amount_cents, due_date,
        sent_at, paid_at, voided_at, payment_instructions, created_at,
        client:clients ( id, name, email, phone, address ),
        booking:bookings ( id, scheduled_at, service_type ),
        line_items:invoice_line_items ( id, label, quantity, unit_price_cents, sort_order ),
        payments:invoice_payments (
          id, amount_cents, method, reference, received_at, notes,
          provider, provider_payment_id
        )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!invoice) notFound();

  // Fetch review_token separately (column not yet in generated types)
  const { data: reviewData } = (await supabase
    .from("invoices")
    .select("review_token")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { review_token: string | null } | null;
  };
  const reviewToken = reviewData?.review_token ?? null;

  const status = invoice.status as InvoiceStatus;
  const paidCents =
    invoice.payments?.reduce((sum, p) => sum + (p.amount_cents ?? 0), 0) ?? 0;
  const balanceCents = Math.max(0, invoice.amount_cents - paidCents);
  const isVoid = !!invoice.voided_at;
  const lineItems = [...(invoice.line_items ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const payments = [...(invoice.payments ?? [])].sort(
    (a, b) =>
      new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
  );

  return (
    <PageShell
      title={invoice.number ?? "Invoice"}
      description={`For ${invoice.client?.name ?? "—"}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/invoices"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <Link
            href={`/app/invoices/${invoice.id}/edit`}
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* Header card — brand accent */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div
              className="h-1 w-full"
              style={{
                backgroundColor: `var(--brand, #6366f1)`,
              }}
            />
            <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="sollos-label">Invoice</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  {invoice.number ?? "—"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {invoice.client?.name ?? "—"}
                  {invoice.client?.address && (
                    <>
                      {" · "}
                      <span>{invoice.client.address}</span>
                    </>
                  )}
                </p>
              </div>
              <StatusBadge tone={invoiceStatusTone(status)}>
                {humanizeEnum(status)}
              </StatusBadge>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Metric label="Total" value={formatCurrencyCents(invoice.amount_cents, currency)} />
              <Metric
                label="Paid"
                value={formatCurrencyCents(paidCents, currency)}
                tone="green"
              />
              <Metric
                label="Balance"
                value={formatCurrencyCents(balanceCents, currency)}
                tone={balanceCents > 0 ? "amber" : "neutral"}
              />
              <Metric
                label="Due"
                value={invoice.due_date ? formatDate(invoice.due_date) : "—"}
              />
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {status === "draft" && !isVoid && (
                <SendInvoiceButton invoiceId={invoice.id} />
              )}
              {stripeReady && !isVoid && balanceCents > 0 && (
                <StripePaymentLinkButton invoiceId={invoice.id} />
              )}
              {invoice.public_token && (
                <Link
                  href={`/i/${invoice.public_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <ExternalLink className="h-4 w-4" />
                  View public link
                </Link>
              )}
              {status === "paid" && reviewToken ? (
                <Link
                  href={`/review/${reviewToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Star className="h-4 w-4" />
                  Review link
                </Link>
              ) : status === "paid" ? (
                <form action={generateReviewTokenAction}>
                  <input type="hidden" name="id" value={invoice.id} />
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    pendingLabel="Generating…"
                  >
                    <Star className="h-4 w-4" />
                    Generate review link
                  </SubmitButton>
                </form>
              ) : null}
              {!isVoid && (
                <form
                  action={voidInvoiceAction}
                  className="ml-auto"
                >
                  <input type="hidden" name="id" value={invoice.id} />
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    pendingLabel="Voiding…"
                  >
                    <Ban className="h-4 w-4" />
                    Void invoice
                  </SubmitButton>
                </form>
              )}
            </div>
            </div>{/* close p-6 inner wrapper */}
          </div>{/* close overflow-hidden card */}

          {/* Line items */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <p className="sollos-label">Line items</p>
              <Link
                href={`/app/invoices/${invoice.id}/edit`}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Edit items
              </Link>
            </div>
            {lineItems.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs text-muted-foreground">
                No line items yet. Use Edit to add some.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lineItems.map((li) => {
                  const subtotal =
                    Math.round((li.quantity ?? 1) * li.unit_price_cents);
                  return (
                    <li
                      key={li.id}
                      className="flex items-baseline justify-between gap-3 px-6 py-3 text-sm"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{li.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {Number(li.quantity).toFixed(2)} ×{" "}
                          {formatCurrencyCents(li.unit_price_cents, currency)}
                        </p>
                      </div>
                      <span className="font-mono tabular-nums">
                        {formatCurrencyCents(subtotal, currency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Payments */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <p className="sollos-label">Payments</p>
              <span className="text-[11px] text-muted-foreground">
                {payments.length} recorded
              </span>
            </div>

            {!isVoid && balanceCents > 0 && (
              <div className="border-b border-border px-6 py-4">
                <RecordPaymentForm
                  invoiceId={invoice.id}
                  balanceCents={balanceCents}
                />
              </div>
            )}

            {payments.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs text-muted-foreground">
                {isVoid
                  ? "This invoice is voided."
                  : "No payments recorded yet."}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {formatCurrencyCents(p.amount_cents, currency)}
                        </span>
                        <StatusBadge tone="neutral">
                          {humanizePaymentMethod(p.method)}
                        </StatusBadge>
                        {p.provider && (
                          <StatusBadge tone="blue">
                            via {p.provider}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(p.received_at)}
                        {p.reference && (
                          <>
                            {" · "}
                            <span className="font-mono">{p.reference}</span>
                          </>
                        )}
                      </p>
                      {p.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {p.notes}
                        </p>
                      )}
                    </div>
                    {!p.provider && (
                      <PaymentRowActions
                        payment={{
                          id: p.id,
                          invoice_id: invoice.id,
                          amount_cents: p.amount_cents,
                          method: p.method,
                          reference: p.reference,
                          notes: p.notes,
                          received_at: p.received_at,
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right column */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Client</p>
            <dl className="mt-3 space-y-2 text-xs">
              <Row label="Name" value={invoice.client?.name ?? "—"} />
              <Row label="Email" value={invoice.client?.email ?? "—"} />
              <Row label="Phone" value={invoice.client?.phone ?? "—"} />
            </dl>
          </div>

          {invoice.booking?.id && (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="sollos-label">Linked booking</p>
              <dl className="mt-3 space-y-2 text-xs">
                <Row
                  label="Service"
                  value={humanizeEnum(invoice.booking.service_type)}
                />
                <Row
                  label="Scheduled"
                  value={formatDateTime(invoice.booking.scheduled_at)}
                />
              </dl>
              <Link
                href={`/app/bookings/${invoice.booking.id}`}
                className="mt-3 inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Open booking →
              </Link>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Meta</p>
            <dl className="mt-3 space-y-2 text-xs">
              <Row label="Created" value={formatDateTime(invoice.created_at)} />
              <Row
                label="Sent"
                value={invoice.sent_at ? formatDateTime(invoice.sent_at) : "—"}
              />
              <Row
                label="Paid"
                value={invoice.paid_at ? formatDateTime(invoice.paid_at) : "—"}
              />
              <Row
                label="Voided"
                value={
                  invoice.voided_at ? formatDateTime(invoice.voided_at) : "—"
                }
              />
            </dl>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  const color =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}
