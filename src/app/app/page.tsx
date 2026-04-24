import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  DollarSign,
  Receipt,
  Rocket,
  Star,
  TrendingUp,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import {
  StatusBadge,
  bookingStatusTone,
  formatBookingStatus,
} from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDate,
  formatDateTime,
  DEFAULT_TZ,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const membership = await requireMembership();
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  // -------- Time windows in the org's display timezone --------
  // On Vercel the server clock is UTC. We need "today" to mean today in the
  // org's timezone (e.g. America/New_York) so that "today's jobs" is correct.
  const now = new Date();
  const todayStart = startOfDayInTz(now);
  const todayEnd = endOfDayInTz(now);
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
    orgSettings,
    orgBranding,
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `id, scheduled_at, status, total_cents, duration_minutes,
         client:clients ( name ),
         assigned:memberships!bookings_assigned_to_fkey (
           display_name,
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
         employee:memberships ( id, display_name, profile:profiles ( full_name ) )`,
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
    supabase
      .from("organizations")
      .select("onboarding_completed_at")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as { data: { onboarding_completed_at: string | null } | null },
    supabase
      .from("organizations")
      .select("logo_url, brand_color")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as {
      data: { logo_url: string | null; brand_color: string | null } | null;
    },
  ]);

  // -------- Onboarding state --------
  const showOnboarding =
    !orgSettings.data?.onboarding_completed_at &&
    (membership.role === "owner" || membership.role === "admin");

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
    const name = memberDisplayName(r.employee);
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
        meta: formatCurrencyCents(b.total_cents, currency),
        href: "/app/bookings",
      }),
    ),
    ...reviews.slice(0, 5).map(
      (r): Activity => ({
        kind: "review",
        at: r.submitted_at,
        title: `${r.rating}★ from ${r.client?.name ?? "client"}`,
        meta: r.employee ? memberDisplayName(r.employee) : "—",
        rating: r.rating,
        href: "/app/reviews",
      }),
    ),
    ...(recentPaidInvoices.data ?? []).map(
      (i): Activity => ({
        kind: "invoice_paid",
        at: i.paid_at!,
        title: `Invoice paid · ${i.client?.name ?? "—"}`,
        meta: formatCurrencyCents(i.amount_cents, currency),
        href: "/app/invoices",
      }),
    ),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10);

  const brandHex = orgBranding.data?.brand_color ?? null;
  const orgLogo = orgBranding.data?.logo_url ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          {orgLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={orgLogo}
              alt={membership.organization_name}
              className="h-10 w-10 shrink-0 rounded-lg object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome back to {membership.organization_name}.
            </p>
          </div>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          {now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: DEFAULT_TZ,
          })}
        </p>
      </div>

      {/* ONBOARDING BANNER */}
      {showOnboarding && (
        <Link
          href="/app/setup"
          className="group mb-6 flex items-center gap-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-5 py-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-violet-950/30"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-indigo-500/25">
            <Rocket className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Finish setting up your workspace
            </p>
            <p className="mt-0.5 text-xs text-indigo-600/70 dark:text-indigo-400/70">
              A few quick steps to get {membership.organization_name} up and running.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-indigo-400 transition-transform group-hover:translate-x-1" />
        </Link>
      )}

      {/* HERO METRIC CARDS */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeroCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Today's revenue"
          value={formatCurrencyCents(todaysRevenue, currency)}
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
          value={formatCurrencyCents(thisWeekRevenue, currency)}
          delta={pctDelta(thisWeekRevenue, lastWeekRevenue)}
          sub="completed jobs only"
        />
        <HeroCard
          icon={<Receipt className="h-4 w-4" />}
          label="Outstanding invoices"
          value={formatCurrencyCents(openInvoicesTotal, currency)}
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
                      {formatDateTime(b.scheduled_at, tz)} ·{" "}
                      {b.assigned ? memberDisplayName(b.assigned) : "Unassigned"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={bookingStatusTone(b.status)}>
                      {formatBookingStatus(b.status)}
                    </StatusBadge>
                    <span className="w-16 text-right text-sm font-medium tabular-nums">
                      {formatCurrencyCents(b.total_cents, currency)}
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
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: `var(--brand, #10b981)`,
                          }}
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
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `var(--brand-light, rgba(99,102,241,0.1))`,
            color: `var(--brand, #6366f1)`,
          }}
        >
          {icon}
        </span>
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

/**
 * Return the start-of-day in the org's display timezone as a UTC Date.
 *
 * On Vercel the server clock is UTC, so `setHours(0)` gives midnight UTC —
 * not midnight Eastern. We format the current wall-clock date in the target
 * timezone, compute the UTC offset, then return midnight-in-TZ as a UTC Date.
 */
function startOfDayInTz(d: Date): Date {
  // 1. What date is it in the target timezone right now?
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TZ,
  }).format(d); // "2026-04-13"

  // 2. Midnight UTC for that calendar date
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);

  // 3. Compute the TZ offset at that moment
  const utcRepr = new Date(
    utcMidnight.toLocaleString("en-US", { timeZone: "UTC" }),
  );
  const tzRepr = new Date(
    utcMidnight.toLocaleString("en-US", { timeZone: DEFAULT_TZ }),
  );
  const offsetMs = utcRepr.getTime() - tzRepr.getTime();

  // 4. Shift: midnight-in-TZ = UTC midnight + offset
  return new Date(utcMidnight.getTime() + offsetMs);
}

function endOfDayInTz(d: Date): Date {
  const start = startOfDayInTz(d);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
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
