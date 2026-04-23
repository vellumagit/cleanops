import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { humanizePaymentMethod } from "@/lib/validators/invoice-payment";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";
import { startSquareCheckoutAction } from "./pay-actions";

export const metadata: Metadata = {
  title: "Invoice",
  description: "View and pay your invoice.",
  robots: { index: false, follow: false },
};

/**
 * Public, no-login invoice view.
 *
 * Reads with the SERVICE-ROLE client because the caller is the end client
 * (the cleaning company's customer), who has no Sollos account. The
 * capability is the 16-char `public_token` in the URL.
 *
 * Phase 12 Part 1: payment CTA is a placeholder. Once an org connects a
 * processor (Stripe / Square / QBO) in settings, this page will light up
 * a "Pay now" button that kicks off the Checkout / Payment Link flow.
 * Until then we show the org's manual payment instructions (Zelle,
 * check, wire, etc) so the client can still actually pay.
 */
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  // Rate limit by IP to slow token brute-force. 30 req/min per IP is
  // generous for legitimate use (a client refreshing the page, checking on
  // their phone and laptop) but makes enumeration impractical.
  const rl = await checkIpRateLimit("inv-token", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const admin = createSupabaseAdminClient();

  const { data: invoice } = await admin
    .from("invoices")
    .select(
      `
        id, number, status, amount_cents, due_date, sent_at, paid_at,
        voided_at, payment_instructions, created_at,
        organization:organizations ( id, name, default_payment_instructions ),
        client:clients ( name, email ),
        line_items:invoice_line_items (
          id, label, quantity, unit_price_cents, sort_order
        ),
        payments:invoice_payments (
          id, amount_cents, method, received_at, provider
        )
      `,
    )
    .eq("public_token", token)
    .maybeSingle();

  if (!invoice) notFound();

  // Fetch tax columns on the invoice separately — not yet in the
  // generated Supabase types.
  const { data: taxData } = (await admin
    .from("invoices")
    .select("tax_rate_bps, tax_amount_cents, tax_label")
    .eq("id", invoice.id)
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

  // Fetch branding + contact info (columns not yet in generated types,
  // so they're fetched separately with an `as unknown as` cast rather
  // than embedded in the invoice select above).
  const orgId = invoice.organization?.id;
  let orgBranding: { logo_url: string | null; brand_color: string | null } = {
    logo_url: null,
    brand_color: null,
  };
  let orgContact: { contact_email: string | null; contact_phone: string | null } = {
    contact_email: null,
    contact_phone: null,
  };
  if (orgId) {
    const { data } = await admin
      .from("organizations")
      .select("logo_url, brand_color, contact_email, contact_phone")
      .eq("id", orgId)
      .maybeSingle() as unknown as {
      data: {
        logo_url: string | null;
        brand_color: string | null;
        contact_email: string | null;
        contact_phone: string | null;
      } | null;
    };
    if (data) {
      orgBranding = { logo_url: data.logo_url, brand_color: data.brand_color };
      orgContact = {
        contact_email: data.contact_email,
        contact_phone: data.contact_phone,
      };
    }
  }

  const currency = orgId ? await getOrgCurrency(orgId) : "CAD";

  const lineItems = [...(invoice.line_items ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const payments = [...(invoice.payments ?? [])].sort(
    (a, b) =>
      new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
  );
  const paidCents = payments.reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);
  const balanceCents = Math.max(0, invoice.amount_cents - paidCents);
  const isVoid = !!invoice.voided_at;
  const isPaid = invoice.status === "paid" || balanceCents === 0;
  const paymentInstructions =
    invoice.payment_instructions ??
    invoice.organization?.default_payment_instructions ??
    null;

  // Does this org have an active Square connection? If yes the public
  // page shows a "Pay with Square" button that mints a checkout link.
  const { data: squareConn } = orgId
    ? ((await admin
        .from("integration_connections" as never)
        .select("id")
        .eq("organization_id" as never, orgId as never)
        .eq("provider" as never, "square" as never)
        .eq("status" as never, "active" as never)
        .maybeSingle()) as unknown as { data: { id: string } | null })
    : { data: null };
  const squareAvailable = Boolean(squareConn);

  const brandCss = orgBranding.brand_color
    ? {
        "--brand": `#${orgBranding.brand_color}`,
        "--brand-rgb": (() => {
          const h = orgBranding.brand_color;
          return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
        })(),
        "--brand-light": (() => {
          const h = orgBranding.brand_color;
          return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},0.10)`;
        })(),
      }
    : {};

  return (
    <main
      className="sollos-wash relative flex flex-1 justify-center px-4 py-10"
      style={brandCss as React.CSSProperties}
    >
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-2xl">
        {/* Brand header */}
        <div className="mx-auto mb-6 flex w-max items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={orgBranding.logo_url || "/sollos-logo.png"}
            alt={invoice.organization?.name ?? "Sollos 3"}
            className="h-10 w-10 shrink-0 rounded-lg object-contain"
          />
          <span className="text-lg font-semibold tracking-tight">
            {invoice.organization?.name ?? "Sollos 3"}
          </span>
        </div>

        <div className="sollos-card overflow-hidden shadow-lg sm:p-0">
          {/* Brand accent bar */}
          <div
            className="h-1.5 w-full"
            style={{
              backgroundColor: `var(--brand, #6366f1)`,
            }}
          />
          <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div>
              <p className="sollos-label">Invoice</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {invoice.number ?? "—"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                For {invoice.client?.name ?? "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="sollos-label">Amount due</p>
              <p
                className={`mt-1 text-3xl font-bold tabular-nums ${
                  isVoid
                    ? "text-muted-foreground line-through"
                    : isPaid
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-foreground"
                }`}
              >
                {formatCurrencyCents(balanceCents, currency)}
              </p>
              {invoice.due_date && !isVoid && !isPaid && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Due {formatDate(invoice.due_date)}
                </p>
              )}
            </div>
          </div>

          {/* State banner */}
          {isVoid ? (
            <Banner tone="neutral">
              This invoice has been voided. No payment is required.
            </Banner>
          ) : isPaid ? (
            <Banner tone="green">
              Paid in full. Thanks! Keep this page for your records.
            </Banner>
          ) : (
            <Banner tone="amber">
              Please submit payment by{" "}
              {invoice.due_date ? formatDate(invoice.due_date) : "the due date"}.
            </Banner>
          )}

          {/* Line items */}
          <div className="mt-6">
            <p className="sollos-label mb-3">Details</p>
            {lineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No line items on this invoice.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {lineItems.map((li) => {
                  const subtotal = Math.round(
                    (li.quantity ?? 1) * li.unit_price_cents,
                  );
                  return (
                    <li
                      key={li.id}
                      className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm"
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

            <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              {/* When tax is set, show the breakdown Subtotal → Tax →
                  Total so the client sees exactly what they're paying
                  tax on. When not set, just Total (and Paid / Balance). */}
              {taxAmountCents !== null && taxAmountCents > 0 && (
                <>
                  <SummaryRow
                    label="Subtotal"
                    value={formatCurrencyCents(
                      invoice.amount_cents - taxAmountCents,
                      currency,
                    )}
                  />
                  <SummaryRow
                    label={`${taxLabel || "Tax"}${
                      taxRateBps
                        ? ` (${(taxRateBps / 100)
                            .toFixed(2)
                            .replace(/\.?0+$/, "")}%)`
                        : ""
                    }`}
                    value={formatCurrencyCents(taxAmountCents, currency)}
                  />
                </>
              )}
              <SummaryRow
                label="Total"
                value={formatCurrencyCents(invoice.amount_cents, currency)}
              />
              {paidCents > 0 && (
                <SummaryRow
                  label="Paid to date"
                  value={`− ${formatCurrencyCents(paidCents, currency)}`}
                  tone="green"
                />
              )}
              <SummaryRow
                label="Balance"
                value={formatCurrencyCents(balanceCents, currency)}
                bold
              />
            </dl>
          </div>

          {/* Payment CTA — only render the block when there's actually something
              to show: an enabled pay button, written instructions, or both.
              If the org hasn't set up card payments AND hasn't entered
              instructions, the block is suppressed entirely rather than
              taunting the client with a disabled "not enabled" button. */}
          {!isVoid && !isPaid && (squareAvailable || paymentInstructions) && (
            <div className="mt-6 rounded-lg border border-border bg-muted/20 p-5">
              <p className="sollos-label">How to pay</p>

              {squareAvailable && (
                <form action={startSquareCheckoutAction}>
                  <input type="hidden" name="token" value={token} />
                  <button
                    type="submit"
                    className="mt-3 inline-flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{
                      backgroundColor: `var(--brand, #6366f1)`,
                    }}
                  >
                    Pay with card
                  </button>
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">
                    You&rsquo;ll be sent to Square&rsquo;s secure checkout.
                  </p>
                </form>
              )}

              {paymentInstructions && (
                <div className={squareAvailable ? "mt-4" : "mt-3"}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment instructions
                  </p>
                  <div className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm text-foreground">
                    {paymentInstructions}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment history (if any) */}
          {payments.length > 0 && (
            <div className="mt-6">
              <p className="sollos-label mb-3">Payments received</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium tabular-nums">
                        {formatCurrencyCents(p.amount_cents, currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.received_at)} ·{" "}
                        {humanizePaymentMethod(p.method)}
                        {p.provider ? ` · via ${p.provider}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                      Received
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contact block — uses org contact_email / contact_phone when
              set. Previously the footer told clients to "reply to the
              email this invoice came from", but that's a noreply@ black
              hole. Now we print a real email + phone if the owner set
              them in Settings → Email & contact info. */}
          {(orgContact.contact_email || orgContact.contact_phone) && (
            <div className="mt-6 rounded-lg border border-border bg-muted/20 p-5">
              <p className="sollos-label">Questions?</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Get in touch with{" "}
                {invoice.organization?.name ?? "the sender"}:
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                {orgContact.contact_email && (
                  <div className="flex items-baseline gap-3">
                    <dt className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Email
                    </dt>
                    <dd>
                      <a
                        href={`mailto:${orgContact.contact_email}`}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {orgContact.contact_email}
                      </a>
                    </dd>
                  </div>
                )}
                {orgContact.contact_phone && (
                  <div className="flex items-baseline gap-3">
                    <dt className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </dt>
                    <dd>
                      <a
                        href={`tel:${orgContact.contact_phone.replace(/[^\d+]/g, "")}`}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {orgContact.contact_phone}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          </div>{/* close p-6 sm:p-8 inner wrapper */}
        </div>{/* close sollos-card */}

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          {orgContact.contact_email || orgContact.contact_phone
            ? `Sent on behalf of ${invoice.organization?.name ?? "the sender"} via Sollos.`
            : `Questions? Reply to the email this invoice came from and ${invoice.organization?.name ?? "the sender"} will get back to you.`}
        </p>
      </div>
    </main>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "green" | "amber" | "neutral";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
        : "border-border bg-muted/30 text-muted-foreground";
  return (
    <div className={`mt-5 rounded-md border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone = "neutral",
  bold = false,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "green";
  bold?: boolean;
}) {
  const color =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`font-mono tabular-nums ${color} ${
          bold ? "text-base font-bold" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
