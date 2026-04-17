import { Download } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents, formatDate } from "@/lib/format";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const params = await searchParams;
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 90);

  const from = params.from || defaultFrom.toISOString().slice(0, 10);
  const to = params.to || now.toISOString().slice(0, 10);

  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:59Z`;

  // Parallel fetch — all scoped to window
  const [
    { data: invoices },
    { data: bookings },
    { data: reviews },
    { data: clients },
    { data: topClientsRaw },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("amount_cents, status, created_at, paid_at")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .limit(5000),
    supabase
      .from("bookings")
      .select(
        "id, status, scheduled_at, assigned_to, service_type, total_cents, client_id",
      )
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .limit(5000),
    supabase
      .from("reviews")
      .select("rating, submitted_at, employee_id")
      .gte("submitted_at", fromIso)
      .lte("submitted_at", toIso)
      .limit(2000),
    supabase.from("clients").select("id, name, created_at"),
    supabase
      .from("invoices")
      .select("amount_cents, client_id, clients ( name )")
      .eq("status", "paid")
      .gte("paid_at", fromIso)
      .lte("paid_at", toIso)
      .limit(2000),
  ]);

  // Aggregates
  const totalRevenue =
    (invoices ?? [])
      .filter((i) => i.status === "paid")
      .reduce((s, i) => s + (i.amount_cents ?? 0), 0);

  const outstandingRevenue =
    (invoices ?? [])
      .filter((i) => ["sent", "overdue", "partially_paid"].includes(i.status))
      .reduce((s, i) => s + (i.amount_cents ?? 0), 0);

  const totalBookings = bookings?.length ?? 0;
  const completedBookings = (bookings ?? []).filter(
    (b) => b.status === "completed",
  ).length;
  const cancelledBookings = (bookings ?? []).filter(
    (b) => b.status === "cancelled",
  ).length;

  const avgRating =
    (reviews ?? []).length > 0
      ? (reviews ?? []).reduce((s, r) => s + r.rating, 0) / reviews!.length
      : null;

  const newClients = (clients ?? []).filter((c) => {
    const created = new Date(c.created_at);
    return created >= new Date(fromIso) && created <= new Date(toIso);
  }).length;

  // Revenue by month (paid_at)
  const revenueByMonth = new Map<string, number>();
  for (const inv of invoices ?? []) {
    if (inv.status !== "paid" || !inv.paid_at) continue;
    const m = inv.paid_at.slice(0, 7); // YYYY-MM
    revenueByMonth.set(m, (revenueByMonth.get(m) ?? 0) + (inv.amount_cents ?? 0));
  }
  const monthEntries = [...revenueByMonth.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const maxMonthRevenue = Math.max(0, ...monthEntries.map(([, v]) => v));

  // Bookings by service type
  const byService = new Map<string, number>();
  for (const b of bookings ?? []) {
    const key = b.service_type ?? "unknown";
    byService.set(key, (byService.get(key) ?? 0) + 1);
  }
  const serviceEntries = [...byService.entries()].sort((a, b) => b[1] - a[1]);

  // Top clients by revenue
  const clientRevenue = new Map<
    string,
    { name: string; total: number }
  >();
  for (const inv of (topClientsRaw ?? []) as Array<{
    amount_cents: number;
    client_id: string;
    clients: { name: string } | null;
  }>) {
    if (!inv.client_id) continue;
    const existing = clientRevenue.get(inv.client_id) ?? {
      name: inv.clients?.name ?? "—",
      total: 0,
    };
    existing.total += inv.amount_cents ?? 0;
    clientRevenue.set(inv.client_id, existing);
  }
  const topClients = [...clientRevenue.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const maxClientRevenue = Math.max(0, ...topClients.map((c) => c.total));

  return (
    <PageShell
      title="Reports"
      description={`Performance from ${formatDate(from)} to ${formatDate(to)}`}
      actions={
        <a
          href={`/app/reports/export?from=${from}&to=${to}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </a>
      }
    >
      <form className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
        >
          Update
        </button>
      </form>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Paid revenue" value={formatCurrencyCents(totalRevenue, currency)} tone="green" />
        <Kpi label="Outstanding" value={formatCurrencyCents(outstandingRevenue, currency)} tone="amber" />
        <Kpi label="Bookings" value={String(totalBookings)} />
        <Kpi
          label="Completion rate"
          value={
            totalBookings > 0
              ? `${Math.round((completedBookings / totalBookings) * 100)}%`
              : "—"
          }
        />
        <Kpi
          label="Avg rating"
          value={avgRating ? `${avgRating.toFixed(2)} / 5` : "—"}
        />
        <Kpi label="New clients" value={String(newClients)} />
      </div>

      {/* Revenue by month */}
      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Revenue by month</h2>
        {monthEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No paid invoices in this window.
          </p>
        ) : (
          <div className="space-y-2">
            {monthEntries.map(([month, value]) => {
              const pct = maxMonthRevenue > 0 ? (value / maxMonthRevenue) * 100 : 0;
              const [year, m] = month.split("-");
              const label = new Date(Number(year), Number(m) - 1).toLocaleString(
                "en-US",
                { month: "short", year: "2-digit" },
              );
              return (
                <div key={month} className="flex items-center gap-3 text-sm">
                  <div className="w-16 shrink-0 text-xs text-muted-foreground">
                    {label}
                  </div>
                  <div className="relative flex-1">
                    <div className="h-6 rounded-md bg-muted">
                      <div
                        className="h-6 rounded-md bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">
                    {formatCurrencyCents(value, currency)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Two-column: service mix + top clients */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">Service mix</h2>
          {serviceEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bookings in this window.</p>
          ) : (
            <div className="space-y-2">
              {serviceEntries.map(([type, count]) => {
                const pct = totalBookings > 0 ? (count / totalBookings) * 100 : 0;
                return (
                  <div key={type} className="flex items-center gap-3 text-sm">
                    <div className="w-24 shrink-0 text-xs capitalize">
                      {type.replace(/_/g, " ")}
                    </div>
                    <div className="relative flex-1">
                      <div className="h-5 rounded-md bg-muted">
                        <div
                          className="h-5 rounded-md bg-blue-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs tabular-nums">
                      {count} ({pct.toFixed(0)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">Top clients by revenue</h2>
          {topClients.length === 0 ? (
            <p className="text-xs text-muted-foreground">No paid invoices yet.</p>
          ) : (
            <div className="space-y-2">
              {topClients.map((c, i) => {
                const pct =
                  maxClientRevenue > 0 ? (c.total / maxClientRevenue) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="w-32 shrink-0 truncate text-xs" title={c.name}>
                      {c.name}
                    </div>
                    <div className="relative flex-1">
                      <div className="h-5 rounded-md bg-muted">
                        <div
                          className="h-5 rounded-md bg-violet-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">
                      {formatCurrencyCents(c.total, currency)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Completed bookings" value={String(completedBookings)} />
        <StatCard label="Cancelled bookings" value={String(cancelledBookings)} />
        <StatCard label="Reviews received" value={String((reviews ?? []).length)} />
      </div>
    </PageShell>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "neutral";
}) {
  const valClass =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${valClass}`}>
        {value}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
