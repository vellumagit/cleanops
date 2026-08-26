import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Ban,
  ExternalLink,
  Star,
  TriangleAlert,
} from "lucide-react";
import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { netPaidCents, outstandingBalanceCents } from "@/lib/invoice-balance";
import { getOrgCurrency } from "@/lib/org-currency";
import { getInvoiceTips } from "@/lib/invoice-tips";
import { fetchOrgNotificationContext } from "@/app/app/clients/org-contact-default";
import {
  invoiceDeliveryNote,
  type DeliveryNoteClient,
  type InvoiceDeliveryNote,
} from "@/lib/invoice-delivery-note";
import { StripePaymentLinkButton } from "./stripe-payment-link-button";
import { SendInvoiceButton } from "./send-invoice-button";
import { HoldAutoSendButton } from "./hold-auto-send-button";
import { AutoSendNotice } from "./auto-send-notice";
import { ResendInvoiceButton } from "./resend-invoice-button";
import { SyncSageButton } from "./sync-sage-button";
import { SyncQuickBooksButton } from "./sync-quickbooks-button";
import {
  clientBillingName,
  clientBillingAttn,
  clientBillingLine,
} from "@/lib/client-billing-name";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { getOrgTimezone } from "@/lib/org-timezone";
import { HoursCheckCard } from "./hours-check-card";
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
import { voidInvoiceAction, generateReviewTokenAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { RecordPaymentForm } from "./record-payment-form";
import { PaymentRowActions } from "./payment-row-actions";
import { RefundPaymentButton } from "./refund-payment-button";
import { humanizePaymentMethod } from "@/lib/validators/invoice-payment";

export const metadata = { title: "Invoice" };

type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void"
  | "refunded";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const errorFlag = (await searchParams)?.error;
  const membership = await requireMembership(["owner", "admin", "manager"]);
  requireCapability(membership, "invoicing");
  const tz = await getOrgTimezone(membership.organization_id);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const invoiceTips = await getInvoiceTips(id);
  // Money OUT — owner/admin, the same line every other money control draws.
  const canRefund = ["owner", "admin"].includes(membership.role);

  // Check Stripe Connect status on the org — payment link only makes sense
  // if the org has charges enabled.
  const admin = createSupabaseAdminClient();
  const { data: orgStripe } = await admin
    .from("organizations")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", membership.organization_id)
    .maybeSingle();
  const stripeReady = Boolean(
    (
      orgStripe as {
        stripe_account_id: string | null;
        stripe_charges_enabled: boolean;
      } | null
    )?.stripe_account_id &&
    (orgStripe as { stripe_charges_enabled: boolean } | null)
      ?.stripe_charges_enabled,
  );

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      `
        id, number, public_token, status, amount_cents, due_date,
        sent_at, paid_at, voided_at, payment_instructions, created_at,
        client:clients ( id, name, company_name, email, phone, address ),
        booking:bookings!booking_id ( id, scheduled_at, service_type ),
        line_items:invoice_line_items ( id, label, quantity, unit_price_cents, sort_order ),
        payments:invoice_payments (
          id, amount_cents, refunded_cents, method, reference, received_at, notes,
          provider, provider_payment_id
        )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!invoice) notFound();

  // Check Sage Connect status — show the Sync to Sage button only
  // when the org has an active Sage connection.
  const { data: sageConn } = (await admin
    .from("integration_connections" as never)
    .select("id")
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("provider" as never, "sage" as never)
    .eq("status" as never, "active" as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  const sageConnected = Boolean(sageConn);

  // Is this invoice already synced? Column isn't in generated types yet.
  const { data: sageInvRow } = (await admin
    .from("invoices")
    .select("sage_invoice_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { sage_invoice_id: string | null } | null;
  };
  const sageSynced = Boolean(sageInvRow?.sage_invoice_id);

  // Same for QuickBooks — show its Sync button only when connected.
  const { data: qbConn } = (await admin
    .from("integration_connections" as never)
    .select("id")
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("provider" as never, "quickbooks" as never)
    .eq("status" as never, "active" as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  const qbConnected = Boolean(qbConn);
  const { data: qbInvRow } = (await admin
    .from("invoices")
    .select("quickbooks_invoice_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { quickbooks_invoice_id: string | null } | null;
  };
  const qbSynced = Boolean(qbInvRow?.quickbooks_invoice_id);

  // Fetch tax columns separately (not yet in generated types).
  const { data: taxData } = (await supabase
    .from("invoices")
    .select("tax_rate_bps, tax_amount_cents, tax_label")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      tax_rate_bps: number | null;
      tax_amount_cents: number | null;
      tax_label: string | null;
    } | null;
  };
  const taxRateBps = taxData?.tax_rate_bps ?? null;
  const taxAmountCents = taxData?.tax_amount_cents ?? null;
  const taxLabel = taxData?.tax_label ?? null;

  // Fetch review_token separately (column not yet in generated types)
  const { data: reviewData } = (await supabase
    .from("invoices")
    .select("review_token")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { review_token: string | null } | null;
  };
  const reviewToken = reviewData?.review_token ?? null;

  // Auto-send schedule (columns not yet in generated types).
  const { data: autoSendData } = (await supabase
    .from("invoices")
    .select("auto_send_at, auto_send_state")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      auto_send_at: string | null;
      auto_send_state: string | null;
    } | null;
  };
  const autoSendScheduled =
    autoSendData?.auto_send_state === "scheduled" &&
    Boolean(autoSendData?.auto_send_at);

  // Auto-send gave up on this draft ("skipped"/"held") — recompute the
  // owner-readable reason against the client's current settings.
  let delivery: InvoiceDeliveryNote | null = null;
  if (
    autoSendData?.auto_send_state === "skipped" ||
    autoSendData?.auto_send_state === "held"
  ) {
    let noteClient: DeliveryNoteClient | null = null;
    if (invoice.client?.id) {
      const { data: prefRow } = (await admin
        .from("clients")
        .select("email, contact_preference, contact_overrides, sms_opted_in")
        .eq("id", invoice.client.id)
        .maybeSingle()) as unknown as { data: DeliveryNoteClient | null };
      noteClient = prefRow;
    }
    const ctx = await fetchOrgNotificationContext(membership.organization_id);
    delivery = invoiceDeliveryNote({
      autoSendState: autoSendData.auto_send_state,
      status: invoice.status,
      amountCents: invoice.amount_cents,
      client: noteClient,
      orgDefault: ctx.orgDefault,
      smsEnabled: ctx.smsEnabled,
    });
  }

  const status = invoice.status as InvoiceStatus;
  // Net of refunds so the balance due reflects money returned to the client.
  const paidCents = netPaidCents(invoice.payments);
  const balanceCents = outstandingBalanceCents(
    invoice.amount_cents,
    invoice.payments,
  );
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
      description={`For ${clientBillingLine(invoice.client)}`}
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
      {errorFlag === "void_has_payments" && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          This invoice has recorded payments, so it can&rsquo;t be voided —
          that would tell the client no payment was required while keeping
          their money. Refund the card payment (or delete a mistyped manual
          one) first; the invoice can be voided once nothing is paid on it.
        </div>
      )}
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
                    {clientBillingName(invoice.client)}
                    {clientBillingAttn(invoice.client) && (
                      <>
                        {" · Attn: "}
                        <span>{clientBillingAttn(invoice.client)}</span>
                      </>
                    )}
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
                <Metric
                  label="Total"
                  value={formatCurrencyCents(invoice.amount_cents, currency)}
                />
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
                  value={
                    invoice.due_date ? formatDate(invoice.due_date, tz) : "—"
                  }
                />
              </dl>

              {status === "draft" && !isVoid && autoSendScheduled && (
                <AutoSendNotice iso={autoSendData!.auto_send_at!} />
              )}

              {status === "draft" &&
                !isVoid &&
                delivery?.kind === "skipped" && (
                  <p className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{delivery.note}</span>
                  </p>
                )}
              {status === "draft" && !isVoid && delivery?.kind === "held" && (
                <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {delivery.note}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                {status === "draft" && !isVoid && (
                  <SendInvoiceButton invoiceId={invoice.id} />
                )}
                {status === "draft" && !isVoid && autoSendScheduled && (
                  <HoldAutoSendButton invoiceId={invoice.id} />
                )}
                {status !== "draft" && !isVoid && (
                  <ResendInvoiceButton invoiceId={invoice.id} />
                )}
                {stripeReady && !isVoid && balanceCents > 0 && (
                  <StripePaymentLinkButton invoiceId={invoice.id} />
                )}
                {sageConnected && !isVoid && (
                  <SyncSageButton
                    invoiceId={invoice.id}
                    alreadySynced={sageSynced}
                  />
                )}
                {qbConnected && !isVoid && (
                  <SyncQuickBooksButton
                    invoiceId={invoice.id}
                    alreadySynced={qbSynced}
                  />
                )}
                {invoice.public_token && (
                  <Link
                    href={`/i/${invoice.public_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
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
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
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
                  <form action={voidInvoiceAction} className="ml-auto">
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
            </div>
            {/* close p-6 inner wrapper */}
          </div>
          {/* close overflow-hidden card */}

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
                  const subtotal = Math.round(
                    (li.quantity ?? 1) * li.unit_price_cents,
                  );
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

            {/* Subtotal / tax / total breakdown. Only shown when tax
                is set — otherwise the Total metric at the top of the
                page already covers it and an extra block would feel
                redundant. */}
            {taxAmountCents !== null && taxAmountCents > 0 && (
              <dl className="space-y-1 border-t border-border px-6 py-4 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="font-mono tabular-nums">
                    {formatCurrencyCents(
                      invoice.amount_cents - taxAmountCents,
                      currency,
                    )}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {taxLabel || "Tax"}
                    {taxRateBps
                      ? ` (${(taxRateBps / 100)
                          .toFixed(2)
                          .replace(/\.?0+$/, "")}%)`
                      : ""}
                  </dt>
                  <dd className="font-mono tabular-nums">
                    {formatCurrencyCents(taxAmountCents, currency)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 pt-1">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-mono font-bold tabular-nums">
                    {formatCurrencyCents(invoice.amount_cents, currency)}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Billed time vs clocked time — Svitlana's cross-check. */}
          <HoursCheckCard invoiceId={id} tz={tz} />

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
                        {(p.refunded_cents ?? 0) > 0 && (
                          <StatusBadge tone="amber">
                            {formatCurrencyCents(
                              p.refunded_cents ?? 0,
                              currency,
                            )}{" "}
                            refunded
                          </StatusBadge>
                        )}
                        {p.provider && (
                          <StatusBadge tone="blue">
                            via {p.provider}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(p.received_at, tz)}
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
                    {/* Card payments can't be edited or deleted like manual
                        rows — the money genuinely moved — but they CAN be
                        refunded, and only from here: the charge lives on the
                        platform's Stripe account, so the owner has no
                        dashboard of their own to do it from. Owner/admin,
                        matching every other money-out control. */}
                    {(p.provider === "stripe" || p.provider === "square") &&
                      canRefund &&
                      p.amount_cents - (p.refunded_cents ?? 0) > 0 && (
                        <RefundPaymentButton
                          paymentId={p.id}
                          invoiceId={invoice.id}
                          provider={p.provider}
                          remainingCents={p.amount_cents - (p.refunded_cents ?? 0)}
                          remainingLabel={formatCurrencyCents(
                            p.amount_cents - (p.refunded_cents ?? 0),
                            currency,
                          )}
                        />
                      )}
                  </li>
                ))}
              </ul>
            )}

            {/* Why the card charge was bigger than the invoice.
                Without this, a $141.75 Stripe payout against a $120 invoice
                looks like a billing error rather than a client being kind. */}
            {invoiceTips.totalCents > 0 && (
              <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold">
                  Tip: {formatCurrencyCents(invoiceTips.totalCents, currency)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Added by the client at checkout. Charged on top of the
                  invoice, so it isn&rsquo;t counted as payment against the
                  balance.
                </p>
                <ul className="mt-2 space-y-0.5">
                  {invoiceTips.rows.map((t, i) => (
                    <li
                      key={`${t.name}-${i}`}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="truncate">
                        {t.name}
                        {t.paidOut ? "" : " — not yet paid out"}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatCurrencyCents(t.amountCents, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Client</p>
            <dl className="mt-3 space-y-2 text-xs">
              <Row label="Billed to" value={clientBillingName(invoice.client)} />
              {clientBillingAttn(invoice.client) && (
                <Row
                  label="Attn"
                  value={clientBillingAttn(invoice.client) as string}
                />
              )}
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
                  value={formatDateTime(invoice.booking.scheduled_at, tz)}
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
              <Row
                label="Created"
                value={formatDateTime(invoice.created_at, tz)}
              />
              <Row
                label="Sent"
                value={
                  invoice.sent_at ? formatDateTime(invoice.sent_at, tz) : "—"
                }
              />
              <Row
                label="Paid"
                value={
                  invoice.paid_at ? formatDateTime(invoice.paid_at, tz) : "—"
                }
              />
              <Row
                label="Voided"
                value={
                  invoice.voided_at
                    ? formatDateTime(invoice.voided_at, tz)
                    : "—"
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
