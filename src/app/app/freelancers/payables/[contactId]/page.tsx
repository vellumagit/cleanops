import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Mail,
  Phone,
  Download,
  FileText,
  ExternalLink,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  formatCurrencyCents,
  formatDate,
  formatDateTime,
  humanizeEnum,
} from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { getSubcontractorLedger } from "@/lib/subcontractor-payables";
import { RecordPaymentForm } from "./record-payment-form";
import { UploadBillForm } from "./upload-bill-form";
import { DeletePayoutButton } from "./delete-payout-button";
import { DeleteBillButton } from "./delete-bill-button";
import { ViewBillButton } from "./view-bill-button";

export const metadata = { title: "Subcontractor pay" };

export default async function SubcontractorLedgerPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { contactId } = await params;

  const [ledger, currency, tz] = await Promise.all([
    getSubcontractorLedger(membership.organization_id, contactId),
    getOrgCurrency(membership.organization_id),
    getOrgTimezone(membership.organization_id),
  ]);

  if (!ledger.contact) notFound();
  const contact = ledger.contact;
  const canEdit = ["owner", "admin"].includes(membership.role);

  return (
    <PageShell
      title={contact.name}
      description="Subcontractor pay"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/freelancers/payables"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Subcontractor pay
          </Link>
          <a
            href={`/app/freelancers/payables/${contactId}/export`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </a>
          {canEdit && (
            <>
              <UploadBillForm contactId={contactId} />
              <RecordPaymentForm contactId={contactId} />
            </>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* ── Contact + stat tiles ── */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold">{contact.name}</h2>
              {contact.email && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={`mailto:${contact.email}`}
                    className="hover:text-foreground hover:underline underline-offset-2"
                  >
                    {contact.email}
                  </a>
                </p>
              )}
              {contact.phone && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={`tel:${contact.phone}`}
                    className="hover:text-foreground hover:underline underline-offset-2"
                  >
                    {contact.phone}
                  </a>
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              label="Earned"
              value={formatCurrencyCents(ledger.earnedCents, currency)}
            />
            <StatTile
              label="Paid"
              value={formatCurrencyCents(ledger.paidCents, currency)}
            />
            <StatTile
              label="Outstanding"
              value={formatCurrencyCents(ledger.outstandingCents, currency)}
              valueClassName={
                ledger.outstandingCents > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            />
          </div>
        </div>

        {/* ── Jobs ── */}
        <Section title="Jobs" subtitle="Completed jobs this subcontractor claimed.">
          {ledger.jobs.length === 0 ? (
            <EmptyRow text="No completed jobs yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Service</th>
                    <th className="px-4 py-2.5 text-right font-medium">Pay</th>
                    <th className="px-4 py-2.5 text-right font-medium">Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {ledger.jobs.map((j) => (
                    <tr key={j.offerId} className="hover:bg-muted/50">
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatDateTime(j.scheduledAt, tz)}
                      </td>
                      <td className="px-4 py-2.5">
                        {humanizeEnum(j.serviceType)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCurrencyCents(j.payCents, currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {j.bookingId ? (
                          <Link
                            href={`/app/bookings/${j.bookingId}`}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                          >
                            View
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Payments ── */}
        <Section title="Payments" subtitle="What you've paid this subcontractor.">
          {ledger.payouts.length === 0 ? (
            <EmptyRow text="No payments recorded yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Method</th>
                    <th className="px-4 py-2.5 font-medium">Reference</th>
                    <th className="px-4 py-2.5 font-medium">Notes</th>
                    {canEdit && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {ledger.payouts.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/50">
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatDate(p.paidOn, tz)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCurrencyCents(p.amountCents, currency)}
                      </td>
                      <td className="px-4 py-2.5">{p.method ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {p.reference ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {p.notes ?? "—"}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right">
                          <DeletePayoutButton payoutId={p.id} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Invoices ── */}
        <Section title="Invoices" subtitle="Bills this subcontractor sent you.">
          {ledger.bills.length === 0 ? (
            <EmptyRow text="No invoices uploaded yet." />
          ) : (
            <ul className="divide-y divide-border/50">
              {ledger.bills.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.billDate ? formatDate(b.billDate, tz) : formatDate(b.createdAt, tz)}
                      {b.amountCents != null
                        ? ` · ${formatCurrencyCents(b.amountCents, currency)}`
                        : ""}
                      {` · ${b.fileName}`}
                    </p>
                  </div>
                  <ViewBillButton billId={b.id} />
                  {canEdit && (
                    <DeleteBillButton billId={b.id} label={b.label} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </PageShell>
  );
}

function StatTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
