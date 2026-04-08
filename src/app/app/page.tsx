import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  DollarSign,
  Receipt,
  Star,
  TrendingUp,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  StatusBadge,
  bookingStatusTone,
  formatBookingStatus,
} from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  // -------- Time windows (server-local; good enough for v1) --------
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const thisWeekStart = addDays(todayStart, -6); // last 7 days incl today
  const lastWeekStart = addDays(todayStart, -13);
  const lastWeekEnd = addDays(todayStart, -7);
  const thirtyDaysAgo = addDays(todayStart, -30);

  // -------- Run everything in parallel --------
  const [
    todaysJobs,
    thisWeekBookings,
    lastWeekBookings,
    openInvoices,
    overdueInvoiceCount,
    recentReviews,
    recentBookings,
    recentPaidInvoices,
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `id, scheduled_at, status, total_cents, duration_minutes,
         client:clients ( name ),
         assigned:memberships!bookings_assigned_to_fkey (
           profile:profiles ( full_name )
         )`,
      )
      .gte("scheduled_at", todayStart.toISOString())
      .lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("bookings")
      .select("id, total_cents, status")
      .gte("scheduled_at", thisWeekStart.toISOString())
      .lte("scheduled_at", todayEnd.toISOString()),
    supabase
      .from("bookings")
      .select("id, total_cents, status")
      .gte("scheduled_at", lastWeekStart.toISOString())
      .lt("scheduled_at", lastWeekEnd.toISOString()),
    supabase
      .from("invoices")
      .select("id, amount_cents, status")
      .in("status", ["sent", "overdue"]),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("status", "overdue"),
    supabase
      .from("reviews")
      .select(
        `id, rating, submitted_at, comment,
         client:clients ( name ),
         employee:memberships ( id, profile:profiles ( full_name ) )`,
      )
      .gte("submitted_at", thirtyDaysAgo.toISOString())
      .order("submitted_at", { ascending: false }),
    supabase
      .from("bookings")
      .select(
        `id, created_at, status, total_cents,
         client:clients ( name )`,
      )
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("invoices")
      .select(
        `id, paid_at, amount_cents,
         client:clients ( name )`,
      )
      .eq("status", "paid")
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false })
      .limit(5),
  ]);

  // -------- Compute derived metrics --------
  const todaysJobsList = todaysJobs.data ?? [];
  const todaysRevenue = sumCompleted(todaysJobsList);

  const thisWeek = thisWeekBookings.data ?? [];
  const lastWeek = lastWeekBookings.data ?? [];
  const thisWeekJobsCount = thisWeek.length;
  const lastWeekJobsCount = lastWeek.length;
  const thisWeekRevenue = sumCompleted(thisWeek);
  const lastWeekRevenue = sumCompleted(lastWeek);

  const openInv = openInvoices.data ?? [];
  const openInvoicesTotal = openInv.reduce(
    (acc, i) => acc + (i.amount_cents ?? 0),
    0,
  );

  const reviews = recentReviews.data ?? [];
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
      : null;

  // Top performers — group reviews by employee
  const byEmployee = new Map<
    string,
    { name: string; total: number; sum: number }
  >();
  for (const r of reviews) {
    if (!r.employee?.id) continue;
    const id = r.employee.id;
    const name = r.employee.profile?.full_name ?? "Unknown";
    const cur = byEmployee.get(id) ?? { name, total: 0, sum: 0 };
    cur.total += 1;
    cur.sum += r.rating;
    byEmployee.set(id, cur);
  }
  const topPerformers = Array.from(byEmployee.entries())
    .map(([id, v]) => ({
      id,
      name: v.name,
      avg: v.sum / v.total,
      count: v.total,
    }))
    .filter((p) => p.count >= 1)
    .sort((a, b) => b.avg - a.avg || b.count - a.count)
    .slice(0, 5);

  // -------- Build activity feed (mix newest events) --------
  type Activity =
    | {
        kind: "booking_created";
        at: string;
        title: string;
        meta: string;
        href: string;
      }
    | {
        kind: "review";
        at: string;
        title: string;
        meta: string;
        rating: number;
        href: string;
      }
    | {
        kind: "invoice_paid";
        at: string;
        title: string;
        meta: string;
        href: string;
      };

  const activity: Activity[] = [
    ...(recentBookings.data ?? []).slice(0, 5).map(
      (b): Activity => ({
        kind: "booking_created",
        at: b.created_at,
        title: `New booking · ${b.client?.name ?? "—"}`,
        meta: formatCurrencyCents(b.total_cents),
        href: "/app/bookings",
      }),
    ),
    ...reviews.slice(0, 5).map(
      (r): Activity => ({
        kind: "review",
        at: r.submitted_at,
        title: `${r.rating}★ from ${r.client?.name ?? "client"}`,
        meta: r.employee?.profile?.full_name ?? "—",
        rating: r.rating,
        href: "/app/reviews",
      }),
    ),
    ...(recentPaidInvoices.data ?? []).map(
      (i): Activity => ({
        kind: "invoice_paid",
        at: i.paid_at!,
        title: `Invoice paid · ${i.client?.name ?? "—"}`,
        meta: formatCurrencyCents(i.amount_cents),
        href: "/app/invoices",
      }),
    ),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back to {membership.organization_name}.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* HERO METRIC CARDS */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeroCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Today's revenue"
          value={formatCurrencyCents(todaysRevenue)}
          sub={`${todaysJobsList.length} job${
            todaysJobsList.length === 1 ? "" : "s"
          } scheduled`}
        />
        <HeroCard
          icon={<Calendar className="h-4 w-4" />}
          label="This week's jobs"
          value={String(thisWeekJobsCount)}
          delta={pctDelta(thisWeekJobsCount, lastWeekJobsCount)}
          sub="vs last 7 days"
        />
        <HeroCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="This week's revenue"
          value={formatCurrencyCents(thisWeekRevenue)}
          delta={pctDelta(thisWeekRevenue, lastWeekRevenue)}
          sub="completed jobs only"
        />
        <HeroCard
          icon={<Receipt className="h-4 w-4" />}
          label="Outstanding invoices"
          value={formatCurrencyCents(openInvoicesTotal)}
          sub={`${openInv.length} open · ${
            overdueInvoiceCount.count ?? 0
          } overdue`}
          tone={
            (overdueInvoiceCount.count ?? 0) > 0 ? "warning" : "default"
          }
        />
      </div>

      {/* SECONDARY: avg rating + top performers + today's jobs + activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* LEFT — today's jobs */}
        <Panel
          title="Today's jobs"
          subtitle={`${todaysJobsList.length} scheduled`}
          href="/app/bookings"
          className="lg:col-span-2"
        >
          {todaysJobsList.length === 0 ? (
            <EmptyMini
              icon={<Calendar className="h-4 w-4" />}
              text="Nothing on the books for today."
            />
          ) : (
            <ul className="divide-y divide-border">
              {todaysJobsList.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {b.client?.name ?? "—"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatDateTime(b.scheduled_at)} ·{" "}
                      {b.assigned?.profile?.full_name ?? "Unassigned"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={bookingStatusTone(b.status)}>
                      {formatBookingStatus(b.status)}
                    </StatusBadge>
                    <span className="w-16 text-right text-sm font-medium tabular-nums">
                      {formatCurrencyCents(b.total_cents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* RIGHT — avg rating mini */}
        <Panel
          title="Customer satisfaction"
          subtitle="Last 30 days"
          href="/app/reviews"
        >
          {avgRating == null ? (
            <EmptyMini
              icon={<Star className="h-4 w-4" />}
              text="No reviews yet."
            />
          ) : (
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">
                  {avgRating.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground">/ 5.0</span>
              </div>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={cn(
                      "h-4 w-4",
                      n <= Math.round(avgRating)
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30",
                    )}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Based on {reviews.length} review
                {reviews.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </Panel>

        {/* Top performers */}
        <Panel
          title="Top-rated employees"
          subtitle="Last 30 days"
          href="/app/employees"
          className="lg:col-span-2"
        >
          {topPerformers.length === 0 ? (
            <EmptyMini
              icon={<Star className="h-4 w-4" />}
              text="No reviews yet — bonuses kick in once stars start rolling in."
            />
          ) : (
            <ul className="space-y-2.5">
              {topPerformers.map((p, idx) => {
                const pct = (p.avg / 5) * 100;
                return (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className="w-4 text-xs font-medium text-muted-foreground tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {p.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {p.avg.toFixed(2)} · {p.count} review
                          {p.count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Activity feed */}
        <Panel title="Recent activity" subtitle="Latest 10 events">
          {activity.length === 0 ? (
            <EmptyMini
              icon={<CheckCircle2 className="h-4 w-4" />}
              text="No activity yet."
            />
          ) : (
            <ul className="space-y-2.5">
              {activity.map((a, idx) => (
                <li key={`${a.kind}-${idx}`}>
                  <Link
                    href={a.href}
                    prefetch={false}
                    className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                  >
                    <ActivityIcon kind={a.kind} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">
                        {a.title}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {a.meta} · {formatDate(a.at)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function HeroCard({
  icon,
  label,
  value,
  delta,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: { pct: number; direction: "up" | "down" | "flat" } | null;
  sub?: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-5 py-4",
        tone === "warning"
          ? "border-amber-200 dark:border-amber-900/40"
          : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {delta && delta.direction !== "flat" && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium tabular-nums",
              delta.direction === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {delta.direction === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta.pct}%
          </span>
        )}
        {sub && <span className="truncate">{sub}</span>}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  href,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {href && (
          <Link
            href={href}
            prefetch={false}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        )}
      </div>
      <div className="flex-1 px-4 py-3">{children}</div>
    </div>
  );
}

function EmptyMini({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-xs text-muted-foreground">
      <span className="text-muted-foreground/60">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  const cls = "mt-0.5 h-3.5 w-3.5 shrink-0";
  switch (kind) {
    case "booking_created":
      return <Calendar className={cn(cls, "text-sky-500")} />;
    case "review":
      return <Star className={cn(cls, "text-amber-500")} />;
    case "invoice_paid":
      return <CheckCircle2 className={cn(cls, "text-emerald-500")} />;
    default:
      return <CheckCircle2 className={cls} />;
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Sum revenue across bookings, counting only completed jobs (so the
 * dashboard reflects realized revenue rather than pipeline).
 */
function sumCompleted(rows: { total_cents: number; status: string }[]): number {
  return rows
    .filter((r) => r.status === "completed")
    .reduce((acc, r) => acc + (r.total_cents ?? 0), 0);
}

function pctDelta(
  current: number,
  previous: number,
): { pct: number; direction: "up" | "down" | "flat" } | null {
  if (previous === 0) {
    if (current === 0) return { pct: 0, direction: "flat" };
    return { pct: 100, direction: "up" };
  }
  const diff = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(diff));
  if (rounded === 0) return { pct: 0, direction: "flat" };
  return { pct: rounded, direction: diff > 0 ? "up" : "down" };
}
