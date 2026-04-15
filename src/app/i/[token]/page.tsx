import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { humanizePaymentMethod } from "@/lib/validators/invoice-payment";

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

  // Fetch branding (columns not yet in generated types)
  const orgId = invoice.organization?.id;
  let orgBranding: { logo_url: string | null; brand_color: string | null } = {
    logo_url: null,
    brand_color: null,
  };
  if (orgId) {
    const { data } = await admin
      .from("organizations")
      .select("logo_url, brand_color")
      .eq("id", orgId)
      .maybeSingle() as unknown as {
      data: { logo_url: string | null; brand_color: string | null } | null;
    };
    if (data) orgBranding = data;
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

          {/* Payment CTA */}
          {!isVoid && !isPaid && (
            <div className="mt-6 rounded-lg border border-border bg-muted/20 p-5">
              <p className="sollos-label">How to pay</p>

              {/* Placeholder for processor button(s). These will be
                  wired up in Phase 12 Part 2 once OAuth is live. */}
              <button
                type="button"
                disabled
                className="mt-3 inline-flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-semibold text-white opacity-60"
                style={{
                  backgroundColor: `var(--brand, #6366f1)`,
                }}
                title="Online payment coming soon"
              >
                Pay with card — coming soon
              </button>

              {paymentInstructions ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment instructions
                  </p>
                  <div className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm text-foreground">
                    {paymentInstructions}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Please contact {invoice.organization?.name ?? "us"} for
                  payment instructions.
                </p>
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
          </div>{/* close p-6 sm:p-8 inner wrapper */}
        </div>{/* close sollos-card */}

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Questions? Reply to the email this invoice came from and{" "}
          {invoice.organization?.name ?? "the sender"} will get back to you.
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
