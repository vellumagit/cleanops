"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/components/use-url-state";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, invoiceStatusTone } from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDate,
  humanizeEnum,
  type CurrencyCode,
} from "@/lib/format";

export type InvoiceRow = {
  id: string;
  status:
    | "draft"
    | "sent"
    | "partially_paid"
    | "paid"
    | "overdue"
    | "void"
    | "refunded";
  number: string | null;
  amount_cents: number;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  client_name: string;
  /** Auto-send outcome for drafts: skipped = needs the owner (amber),
   *  held = paused deliberately (neutral), scheduled = queued with a send
   *  time (sky). Null = nothing to say. */
  delivery: { kind: "skipped" | "held" | "scheduled"; note: string } | null;
};

/**
 * What the list is FOR, in the order you work it.
 *
 * 245 invoices in one undivided list is not a ledger, it's a haystack: on
 * Svit that was 156 drafts, 45 paid and 18 void burying the 26 that actually
 * wanted doing. The split is by what you'd do next, not by status name —
 * "sent" and "overdue" are the same job (chase the money) and belong together.
 *
 * Done is deliberately one tab, not two. Paid and refunded are both "no longer
 * owed"; separating them would put 45 rows in one bin and a handful in another
 * for a distinction nobody navigates by.
 */
const INVOICE_TABS = [
  { key: "to_send", label: "To send" },
  { key: "awaiting", label: "Awaiting payment" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
] as const;

type InvoiceTab = (typeof INVOICE_TABS)[number]["key"];

function tabFor(status: InvoiceRow["status"]): Exclude<InvoiceTab, "all"> {
  switch (status) {
    case "draft":
      return "to_send";
    case "sent":
    case "partially_paid":
    case "overdue":
      return "awaiting";
    case "paid":
    case "refunded":
      return "paid";
    case "void":
      return "void";
  }
}

/**
 * An empty tab means different things. Nothing awaiting payment is the best
 * news on the page; the generic "No invoices yet" read like a fault.
 */
const EMPTY_BY_TAB: Record<
  InvoiceTab,
  { title: string; description?: string }
> = {
  to_send: {
    title: "Nothing waiting to be sent",
    description: "Drafts from completed bookings land here.",
  },
  awaiting: {
    title: "Nothing outstanding",
    description: "Every invoice you've sent has been paid.",
  },
  paid: {
    title: "No paid invoices yet",
    description: "Invoices move here once they're settled.",
  },
  void: { title: "No voided invoices" },
  all: {
    title: "No invoices yet",
    description: "Invoices generated from completed bookings will show here.",
  },
};

/** One date, three spellings — the display form ("Jul 6, 2026"), the long
 *  month ("July 6, 2026"), and ISO ("2026-07-06") — so a date typed any of
 *  the common ways matches. Rendered in the org timezone like the cell. */
function dateNeedle(iso: string | null, tz: string): string {
  if (!iso) return "";
  const safeIso = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(safeIso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { day: "numeric", year: "numeric", timeZone: tz } as const;
  return [
    d.toLocaleDateString("en-US", { month: "short", ...opts }),
    d.toLocaleDateString("en-US", { month: "long", ...opts }),
    d.toLocaleDateString("en-CA", { timeZone: tz }), // yyyy-mm-dd
  ].join(" ");
}

export function InvoicesTable({
  rows,
  canEdit,
  currency,
  tz,
}: {
  rows: InvoiceRow[];
  canEdit: boolean;
  currency: CurrencyCode;
  /** Org IANA timezone — every date on this table renders in it. */
  tz: string;
}) {
  const router = useRouter();
  // Opens on the money that's owed, not on the whole ledger. Overdue and sent
  // are what a morning actually starts with; drafts are a queue you work when
  // you choose to, and paid is a record you consult rather than read.
  const [tab, setTab] = useUrlState<InvoiceTab>("tab", "awaiting");

  const tabCounts = useMemo(() => {
    const counts: Record<InvoiceTab, number> = {
      to_send: 0,
      awaiting: 0,
      paid: 0,
      void: 0,
      all: rows.length,
    };
    for (const r of rows) counts[tabFor(r.status)]++;
    return counts;
  }, [rows]);

  const visibleRows = useMemo(
    () => (tab === "all" ? rows : rows.filter((r) => tabFor(r.status) === tab)),
    [rows, tab],
  );

  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      render: (r) => (
        <span className="font-medium tabular-nums">{r.number ?? "—"}</span>
      ),
      // Searchable so typing "0127" (or the full INV-2026-0127) finds it —
      // the number is how invoices get referred to in email and on paper.
      searchValue: (r) => r.number ?? "",
    },
    {
      key: "client",
      header: "Client",
      render: (r) => <span className="font-medium">{r.client_name}</span>,
      searchValue: (r) => r.client_name,
    },
    {
      key: "issued",
      header: "Issued",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.created_at, tz)}
        </span>
      ),
      searchValue: (r) => dateNeedle(r.created_at, tz),
    },
    {
      key: "due",
      header: "Due",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.due_date, tz)}
        </span>
      ),
      searchValue: (r) => dateNeedle(r.due_date, tz),
    },
    {
      key: "paid",
      header: "Paid",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.paid_at, tz)}
        </span>
      ),
      searchValue: (r) => dateNeedle(r.paid_at, tz),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge tone={invoiceStatusTone(r.status)}>
            {humanizeEnum(r.status)}
          </StatusBadge>
          {r.delivery?.kind === "skipped" && (
            <span
              title={r.delivery.note}
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            >
              <TriangleAlert className="h-3 w-3" />
              Needs manual delivery
            </span>
          )}
          {r.delivery?.kind === "held" && (
            <span
              title={r.delivery.note}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              Auto-send paused
            </span>
          )}
          {r.delivery?.kind === "scheduled" && (
            <span
              title={r.delivery.note}
              className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400"
            >
              {r.delivery.note.split(" — ")[0]}
            </span>
          )}
        </div>
      ),
      // "overdue", "draft", "paid" — status words are how people filter
      // a ledger in their head; let the box do it too.
      searchValue: (r) => humanizeEnum(r.status),
    },
    {
      key: "amount",
      header: "Amount",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.amount_cents, currency),
      // Both "$183.75" and bare "183.75" match.
      searchValue: (r) =>
        `${formatCurrencyCents(r.amount_cents, currency)} ${(r.amount_cents / 100).toFixed(2)}`,
    },
  ];

  const empty = EMPTY_BY_TAB[tab];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 w-fit">
        {INVOICE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span
              className={cn(
                "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                tab === t.key
                  ? "bg-foreground text-background"
                  : "bg-muted-foreground/20 text-muted-foreground",
              )}
            >
              {tabCounts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <DataTable
        data={visibleRows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search client, invoice #, date, status, amount…"
        onRowClick={
          canEdit ? (r) => router.push(`/app/invoices/${r.id}`) : undefined
        }
        emptyState={empty}
      />
    </div>
  );
}
