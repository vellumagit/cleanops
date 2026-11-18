import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";
import type { PayInvoiceRow } from "@/lib/pay-invoice-list";

/** A DATE column (no time of day): labelled as written, with no zone shift. */
function day(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${ymd}T00:00:00Z`));
}

/**
 * Pay invoices as a table: one row per person per pay period, each with its
 * PDF. Used on Payroll → Invoices (everyone) and on a person's own record
 * (theirs only, so the name column is left out there).
 */
export function PayInvoiceTable({
  rows,
  currency,
  showName,
  timezone,
}: {
  rows: PayInvoiceRow[];
  currency: CurrencyCode;
  showName: boolean;
  /** The company's zone, for the day a run was paid. */
  timezone: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Period</th>
            {showName && <th className="px-4 py-2.5 font-medium">Person</th>}
            <th className="px-4 py-2.5 font-medium">Invoice</th>
            <th className="px-4 py-2.5 text-right font-medium">Hours</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.itemId}`}>
              <td className="whitespace-nowrap px-4 py-2.5">
                {day(r.periodStart)} – {day(r.periodEnd)}
              </td>
              {showName && (
                <td className="px-4 py-2.5">
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.kind === "contractor" ? "Contractor" : "Employee"}
                  </span>
                </td>
              )}
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                {r.number}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.hours.toFixed(2)}</td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                {formatCurrencyCents(r.totalCents, currency)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <StatusBadge tone={r.status === "paid" ? "green" : r.status === "finalized" ? "blue" : "neutral"}>
                  {r.status === "paid" ? "Paid" : r.status === "finalized" ? "Payable" : "Draft"}
                </StatusBadge>
                {r.status === "paid" && r.paidAt && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(
                      new Date(r.paidAt),
                    )}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                <a
                  href={`/api/pay-invoice/${r.kind}/${r.itemId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium underline underline-offset-2 hover:text-foreground"
                >
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
