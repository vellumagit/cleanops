import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { PrintButton } from "./print-button";

export const metadata = { title: "Account Statement" };

export default async function ClientStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const [clientResult, orgResult, invoicesResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, phone, address")
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{
      data: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        address: string | null;
      } | null;
      error: { message: string } | null;
    }>,

    supabase
      .from("organizations")
      .select("name, address, phone, email")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as Promise<{
      data: {
        name: string;
        address: string | null;
        phone: string | null;
        email: string | null;
      } | null;
      error: unknown;
    }>,

    supabase
      .from("invoices")
      .select("id, number, status, amount_cents, issued_at, due_date")
      .eq("client_id", id)
      .order("issued_at", { ascending: true }) as unknown as Promise<{
      data: Array<{
        id: string;
        number: number;
        status: string;
        amount_cents: number;
        issued_at: string | null;
        due_date: string | null;
      }> | null;
      error: unknown;
    }>,
  ]);

  const { data: client, error } = clientResult;
  if (error) throw error;
  if (!client) notFound();

  const invoices = invoicesResult.data ?? [];
  const org = orgResult.data;

  // Fetch payments for all of this client's invoices and sum them
  // per invoice so we can compute the balance on each row.
  const paidByInvoice = new Map<string, number>();
  if (invoices.length > 0) {
    const invoiceIds = invoices.map((inv) => inv.id);
    const paymentsResult = await (supabase
      .from("invoice_payments" as never)
      .select("invoice_id, amount_cents")
      .in("invoice_id" as never, invoiceIds as never)) as unknown as {
      data: Array<{ invoice_id: string; amount_cents: number }> | null;
      error: unknown;
    };
    for (const p of paymentsResult.data ?? []) {
      paidByInvoice.set(
        p.invoice_id,
        (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_cents,
      );
    }
  }

  // Build ledger rows in chronological order.
  const rows = invoices.map((inv) => {
    const paid = paidByInvoice.get(inv.id) ?? 0;
    return {
      ...inv,
      paid_cents: paid,
      balance_cents: inv.amount_cents - paid,
    };
  });

  const totalCharged = rows.reduce((s, r) => s + r.amount_cents, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid_cents, 0);
  const totalBalance = totalCharged - totalPaid;

  const generatedAt = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Screen-only toolbar — hidden when printing */}
      <div className="print:hidden border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <Link
          href={`/app/clients/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to client
        </Link>
        <PrintButton />
      </div>

      {/* Printable content */}
      <div className="mx-auto max-w-4xl px-8 py-10 print:px-0 print:py-0">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Account Statement
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Generated {generatedAt}
            </p>
          </div>
          {org && (
            <div className="text-right text-sm">
              <p className="font-semibold">{org.name}</p>
              {org.address && (
                <p className="text-muted-foreground">{org.address}</p>
              )}
              {org.phone && (
                <p className="text-muted-foreground">{org.phone}</p>
              )}
              {org.email && (
                <p className="text-muted-foreground">{org.email}</p>
              )}
            </div>
          )}
        </div>

        {/* Prepared-for block */}
        <div className="mb-8 rounded-lg border border-border bg-muted/30 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Prepared for
          </p>
          <p className="text-lg font-bold">{client.name}</p>
          {client.email && (
            <p className="text-sm text-muted-foreground">{client.email}</p>
          )}
          {client.phone && (
            <p className="text-sm text-muted-foreground">{client.phone}</p>
          )}
          {client.address && (
            <p className="text-sm text-muted-foreground">{client.address}</p>
          )}
        </div>

        {/* Summary totals */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {(
            [
              {
                label: "Total Charged",
                value: totalCharged,
                colorClass: "",
              },
              {
                label: "Total Paid",
                value: totalPaid,
                colorClass: "text-emerald-600",
              },
              {
                label: "Balance Owing",
                value: totalBalance,
                colorClass: totalBalance > 0 ? "text-rose-600" : "",
              },
            ] as const
          ).map(({ label, value, colorClass }) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-card px-4 py-3 text-center"
            >
              <p className="text-xs text-muted-foreground">{label}</p>
              <p
                className={`text-xl font-bold tabular-nums mt-0.5 ${colorClass}`}
              >
                {formatCurrencyCents(value, currency)}
              </p>
            </div>
          ))}
        </div>

        {/* Invoice ledger table */}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No invoices on file for this client.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-semibold">
                    Invoice
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold">Date</th>
                  <th className="text-left px-4 py-2.5 font-semibold">
                    Status
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold">
                    Charged
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold">
                    Paid
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">
                      INV-{String(row.number).padStart(3, "0")}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.issued_at
                        ? new Date(row.issued_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground capitalize">
                      {row.status.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrencyCents(row.amount_cents, currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">
                      {formatCurrencyCents(row.paid_cents, currency)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                        row.balance_cents > 0 ? "text-rose-600" : ""
                      }`}
                    >
                      {formatCurrencyCents(row.balance_cents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                  <td colSpan={3} className="px-4 py-3">
                    Total
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrencyCents(totalCharged, currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">
                    {formatCurrencyCents(totalPaid, currency)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      totalBalance > 0 ? "text-rose-600" : ""
                    }`}
                  >
                    {formatCurrencyCents(totalBalance, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Print footer */}
        <div className="mt-12 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          <p>
            This statement reflects all invoices on record. Contact us if you
            have any questions or discrepancies.
          </p>
        </div>
      </div>
    </div>
  );
}
