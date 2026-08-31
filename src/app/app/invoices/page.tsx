import Link from "next/link";
import { Plus, CalendarRange, TriangleAlert } from "lucide-react";
import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { fetchOrgNotificationContext } from "@/app/app/clients/org-contact-default";
import { getOrgTimezone } from "@/lib/org-timezone";
import { invoiceDeliveryNote } from "@/lib/invoice-delivery-note";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";
import { BulkInvoiceButton } from "./bulk-invoice-button";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; client?: string }>;
}) {
  const membership = await requireMembership();
  requireCapability(membership, "invoicing");
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();
  // Fired, not awaited — all three resolve while the invoices query runs.
  const currencyPromise = getOrgCurrency(membership.organization_id);
  const notifCtxPromise = fetchOrgNotificationContext(
    membership.organization_id,
  );
  const tzPromise = getOrgTimezone(membership.organization_id);
  const { archived, client } = await searchParams;
  const showArchived = archived === "1";
  const clientFilter = client?.trim() || null;

  let query = supabase.from("invoices").select(
    `
        id,
        number,
        status,
        amount_cents,
        due_date,
        sent_at,
        paid_at,
        created_at,
        auto_send_state,
        auto_send_at,
        client:clients ( name, email, contact_preference, contact_overrides, sms_opted_in )
      ` as never,
  );

  // Explicit org scope — a two-org admin reads both orgs via RLS alone.
  query = query.eq("organization_id" as never, membership.organization_id as never);

  // ?client= — the client page has linked here "scoped to THIS client"
  // since day one; the page just never read it.
  if (clientFilter) query = query.eq("client_id" as never, clientFilter as never);

  query = showArchived
    ? query.not("archived_at" as never, "is" as never, null as never)
    : query.is("archived_at" as never, null as never);

  // 500, and the table is TOLD when it's truncated. At 200, Leslie's two
  // overdue invoices from June/July fell off the newest-N window and the
  // client-side search box swore she only had three invoices — while the
  // booking picker (correctly) showed her July job as already billed.
  // A search over a truncated list must say so, or it's testimony.
  const LIST_LIMIT = 500;
  const { data, error } = (await query
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)) as unknown as {
    data: Array<{
      id: string;
      number: string | null;
      status: InvoiceRow["status"];
      amount_cents: number;
      due_date: string | null;
      sent_at: string | null;
      paid_at: string | null;
      created_at: string;
      auto_send_state: string | null;
      auto_send_at: string | null;
      client: {
        name: string | null;
        email: string | null;
        contact_preference: string | null;
        contact_overrides: Record<string, unknown> | null;
        sms_opted_in: boolean | null;
      } | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) throw error;

  // Surface auto-send misses ("skipped"/"held" drafts) with a live-computed
  // reason — the "silence is never a mystery" rule. Pure function, no extra
  // queries per row.
  const currency = await currencyPromise;
  const { orgDefault, smsEnabled } = await notifCtxPromise;
  const orgTz = await tzPromise;

  const rows: InvoiceRow[] = (data ?? []).map((i) => ({
    id: i.id,
    number: i.number,
    status: i.status,
    amount_cents: i.amount_cents,
    due_date: i.due_date,
    sent_at: i.sent_at,
    paid_at: i.paid_at,
    created_at: i.created_at,
    client_name: i.client?.name ?? "—",
    delivery: invoiceDeliveryNote({
      autoSendState: i.auto_send_state,
      autoSendAt: i.auto_send_at,
      timezone: orgTz,
      status: i.status,
      amountCents: i.amount_cents,
      client: i.client,
      orgDefault,
      smsEnabled,
    }),
  }));

  // Skipped = a miss the owner should act on. Held = paused (possibly the
  // owner's own Hold button) — mentioned, never alarmed.
  const undelivered = rows.filter((r) => r.delivery?.kind === "skipped").length;
  const onHold = rows.filter((r) => r.delivery?.kind === "held").length;

  return (
    <PageShell
      title={showArchived ? "Invoices — archived" : "Invoices"}
      description={
        showArchived
          ? "Paid or voided invoices older than your archive threshold."
          : "Bills sent to clients. Auto-generatable from completed bookings."
      }
      actions={
        <div className="flex items-center gap-2">
          <ArchivedToggle
            basePath="/app/invoices"
            showingArchived={showArchived}
          />
          {canEdit && !showArchived && (
            <>
              <BulkInvoiceButton />
              <Link
                href="/app/invoices/period"
                className={buttonVariants({ variant: "outline" })}
              >
                <CalendarRange className="h-4 w-4" />
                Bill for a period
              </Link>
              <Link
                href="/app/invoices/new"
                className={buttonVariants({ variant: "default" })}
              >
                <Plus className="h-4 w-4" />
                New invoice
              </Link>
            </>
          )}
        </div>
      }
    >
      {undelivered > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {undelivered === 1
                ? "1 invoice couldn't be auto-delivered."
                : `${undelivered} invoices couldn't be auto-delivered.`}
            </p>
            <p className="mt-0.5">
              Look for the &ldquo;Needs manual delivery&rdquo; tag below — hover
              it for the reason, open the invoice to send it yourself.
              {onHold > 0 &&
                ` (${onHold} more ${onHold === 1 ? "is" : "are"} on hold — that one's deliberate.)`}
            </p>
          </div>
        </div>
      )}
      {clientFilter && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
            Filtered to {rows[0]?.client_name ?? "one client"}
          </span>
          <Link
            href="/app/invoices"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Show all invoices
          </Link>
        </div>
      )}
      {rows.length >= LIST_LIMIT && (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          Showing the newest {LIST_LIMIT} invoices — older ones exist, and the
          search box only looks inside what&apos;s shown. For one client&apos;s
          complete history, open their page and use{" "}
          <span className="font-medium">View all</span> beside Recent invoices.
        </div>
      )}
      <InvoicesTable
        tz={orgTz}
        rows={rows}
        canEdit={canEdit && !showArchived}
        currency={currency}
      />
    </PageShell>
  );
}
