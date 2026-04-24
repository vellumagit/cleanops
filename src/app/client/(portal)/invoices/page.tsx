import Link from "next/link";
import { CreditCard, ExternalLink } from "lucide-react";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatCurrencyCents,
  formatDate,
  humanizeEnum,
} from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import {
  StatusBadge,
  invoiceStatusTone,
} from "@/components/status-badge";

export const metadata = { title: "My invoices" };

/** Invoice statuses where the client still owes money. Each row in
 *  this bucket gets a prominent "Pay now" button instead of a subtle
 *  "open public link" icon — clients kept missing that the icon
 *  button was the way to pay. */
const PAYABLE_STATUSES = new Set(["sent", "overdue", "partially_paid"]);

export default async function ClientInvoicesPage() {
  const client = await requireClient();
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(client.organization_id);

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, number, amount_cents, status, due_date, created_at, public_token",
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">My invoices</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Open, paid, or voided — the full history.
        </p>
      </div>

      {(invoices ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="space-y-2">
          {(invoices ?? []).map((inv) => {
            const payable = PAYABLE_STATUSES.has(inv.status as string);
            return (
              <li
                key={inv.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold tabular-nums">
                      {formatCurrencyCents(inv.amount_cents, currency)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Invoice{" "}
                      {inv.number ?? inv.id.slice(0, 8).toUpperCase()}
                      {" · "}
                      {formatDate(inv.created_at)}
                      {inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      tone={invoiceStatusTone(
                        inv.status as
                          | "draft"
                          | "sent"
                          | "paid"
                          | "overdue"
                          | "void"
                          | "partially_paid",
                      )}
                    >
                      {humanizeEnum(inv.status)}
                    </StatusBadge>
                    {/* Payable → big Pay now button (primary CTA).
                        Paid / void → small open-link icon so clients
                        can still view the invoice for records. */}
                    {payable && inv.public_token ? (
                      <Link
                        href={`/i/${inv.public_token}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        Pay now
                      </Link>
                    ) : inv.public_token ? (
                      <Link
                        href={`/i/${inv.public_token}`}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="View invoice"
                        title="View invoice"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
