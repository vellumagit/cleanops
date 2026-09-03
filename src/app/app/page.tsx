import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { requireMembership, can } from "@/lib/auth";
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
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";
import { NeedsAttention } from "./needs-attention";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const [tz, currency] = await Promise.all([
    getOrgTimezone(membership.organization_id),
    getOrgCurrency(membership.organization_id),
  ]);

  // -------- Time windows in the org's display timezone --------
  // On Vercel the server clock is UTC. We need "today" to mean today in the
  // org's timezone (e.g. America/New_York) so that "today's jobs" is correct.
  const now = new Date();
  const todayStart = startOfDayInTz(now, tz);
  const todayEnd = endOfDayInTz(now, tz);
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
    clientCount,
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
    // Recent bookings for the activity feed. scheduled_at and series_id
    // ride along so a recurring generation can be folded into one line —
    // eight occurrences minted in one save all share created_at, and the
    // feed used to print eight identical "New booking · Elena" rows that
    // read as a duplication bug. 24 so one burst can't crowd out the rest.
    supabase
      .from("bookings")
      .select(
        `id, created_at, scheduled_at, series_id, status, total_cents,
         client:clients ( name )`,
      )
      .eq("organization_id", membership.organization_id)
      .order("created_at", { ascending: false })
      .limit(24),
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
      .maybeSingle() as unknown as {
      data: { onboarding_completed_at: string | null } | null;
    },
    supabase
      .from("organizations")
      .select("logo_url, brand_color")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as {
      data: { logo_url: string | null; brand_color: string | null } | null;
    },
    // Used only to decide whether to auto-redirect fresh orgs to setup.
    // NOT filtered to lifecycle='client', deliberately: an org with a website
    // inquiry sitting in Leads has clearly started using the product, and
    // bouncing them back to onboarding would be wrong. This asks "is anything
    // here yet", not "how many customers".
    supabase.from("clients").select("id", { count: "exact", head: true }),
  ]);

  // -------- Onboarding state --------
  const showOnboarding =
    !orgSettings.data?.onboarding_completed_at &&
    (membership.role === "owner" || membership.role === "admin");

  // Auto-redirect brand-new orgs that haven't added any clients yet.
  // Once they add their first client the redirect stops — they can then
  // move through setup at their own pace via the sidebar link and banner.
  // Clicking "Skip setup for now" sets onboarding_completed_at so they
  // will never be redirected again.
  if (showOnboarding && (clientCount.count ?? 0) === 0) {
    redirect("/app/setup");
  }

  // Money on the dashboard answers to the same switch as the Invoices page.
  // The capability shipped hiding /app/invoices from a restricted manager —
  // and left "This week's revenue" on the page they land on first. Olha's
  // complaint was never a URL; it was the numbers.
  const canMoney = can(membership, "invoicing");

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

  // Fold a recurring generation into ONE event. Occurrences created by the
  // same save share series_id + created_at (to the second); shown one per
  // row they are indistinguishable and look like a bug. A single booking
  // shows the day it is FOR, which is what anyone reading "new booking"
  // wants to know — not the second it was typed in.
  type RecentBooking = NonNullable<typeof recentBookings.data>[number] & {
    scheduled_at: string;
    series_id: string | null;
  };
  const bookingEvents: Activity[] = [];
  const seenBurst = new Map<string, { count: number; first: string; last: string; idx: number }>();
  for (const b of (recentBookings.data ?? []) as RecentBooking[]) {
    const burstKey = b.series_id
      ? `${b.series_id}|${b.created_at.slice(0, 19)}`
      : null;
    if (burstKey && seenBurst.has(burstKey)) {
      const g = seenBurst.get(burstKey)!;
      g.count += 1;
      if (b.scheduled_at < g.first) g.first = b.scheduled_at;
      if (b.scheduled_at > g.last) g.last = b.scheduled_at;
      continue;
    }
    if (burstKey) {
      seenBurst.set(burstKey, {
        count: 1,
        first: b.scheduled_at,
        last: b.scheduled_at,
        idx: bookingEvents.length,
      });
    }
    bookingEvents.push({
      kind: "booking_created",
      at: b.created_at,
      title: `New booking · ${b.client?.name ?? "—"}`,
      meta: `${formatCurrencyCents(b.total_cents, currency)} · for ${formatDate(b.scheduled_at, tz)}`,
      href: "/app/bookings",
    });
  }
  for (const g of seenBurst.values()) {
    if (g.count < 2) continue;
    const ev = bookingEvents[g.idx];
    ev.title = ev.title.replace("New booking", `${g.count} visits scheduled`);
    ev.meta = `${formatDate(g.first, tz)} – ${formatDate(g.last, tz)}`;
    ev.href = "/app/bookings/series";
  }

  const activity: Activity[] = [
    ...bookingEvents.slice(0, 5),
    ...reviews.slice(0, 5).map((r): Activity => ({
      kind: "review",
      at: r.submitted_at,
      title: `${r.rating}★ from ${r.client?.name ?? "client"}`,
      meta: r.employee ? memberDisplayName(r.employee) : "—",
      rating: r.rating,
      href: "/app/reviews",
    })),
    ...(recentPaidInvoices.data ?? []).map((i): Activity => ({
      kind: "invoice_paid",
      at: i.paid_at!,
      title: `Invoice paid · ${i.client?.name ?? "—"}`,
      meta: formatCurrencyCents(i.amount_cents, currency),
      href: "/app/invoices",
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10);

  // The feed prices jobs and announces paid invoices — money again.
  const visibleActivity = canMoney
    ? activity
    : activity.filter((a) => a.kind !== "invoice_paid");

  const brandHex = orgBranding.data?.brand_color ?? null;
  const orgLogo = orgBranding.data?.logo_url ?? null;

  return (
    // flex-col so the sections can carry order-* — on a phone the day's
    // jobs and the needs-attention card outrank the stat cards, on desktop
    // (lg:order-none everywhere) the DOM order below is the layout.
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-10">
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
            timeZone: tz,
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
              A few quick steps to get {membership.organization_name} up and
              running.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-indigo-400 transition-transform group-hover:translate-x-1" />
        </Link>
      )}

      {/* HERO METRIC CARDS — three of the four are money, and money answers
          to the invoicing capability. A restricted manager gets the operational
          pair instead: what is happening today, and this week. */}
      {canMoney ? (
        <div className="order-3 mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:order-none lg:grid-cols-4">
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
            tone={(overdueInvoiceCount.count ?? 0) > 0 ? "warning" : "default"}
          />
        </div>
      ) : (
        <div className="order-3 mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:order-none">
          <HeroCard
            icon={<Calendar className="h-4 w-4" />}
            label="Today's jobs"
            value={String(todaysJobsList.length)}
            sub="scheduled today"
          />
          <HeroCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="This week's jobs"
            value={String(thisWeekJobsCount)}
            delta={pctDelta(thisWeekJobsCount, lastWeekJobsCount)}
            sub="vs last 7 days"
          />
        </div>
      )}

      {/* The app saying what it knows before it becomes a support text —
          money-shaped loose ends with the click that fixes each. Gated to
          money-visible roles: every bucket is prices and invoices. */}
      {/* Suspense: the card runs four scans of its own; the dashboard
          paints without waiting and the card streams in when ready. */}
      {canMoney && (
        <div className="order-2 lg:order-none">
          <Suspense fallback={null}>
            <NeedsAttention tz={tz} />
          </Suspense>
        </div>
      )}

      {/* SECONDARY — split into two grids purely so the first (today's
          jobs + rating) can jump above the stats on a phone; on desktop
          the mb-4 reproduces the old single grid's row gap exactly. */}
      {/* Explicit grid-cols-1 at the call site: this grid's cards are the
          ones that ran off a phone (see the :where(.grid) note in
          globals.css for the min-content mechanism). Stating the single
          column here means the fix survives even if that rule is ever
          scoped differently. */}
      <div className="order-1 mb-4 grid grid-cols-1 gap-4 lg:order-none lg:grid-cols-3">
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
                      {b.assigned
                        ? memberDisplayName(b.assigned)
                        : "Unassigned"}
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
      </div>

      <div className="order-4 grid grid-cols-1 gap-4 lg:order-none lg:grid-cols-3">
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
          {visibleActivity.length === 0 ? (
            <EmptyMini
              icon={<CheckCircle2 className="h-4 w-4" />}
              text="No activity yet."
            />
          ) : (
            <ul className="space-y-2.5">
              {visibleActivity.map((a, idx) => (
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
                        {a.kind === "booking_created"
                          ? a.meta
                          : `${a.meta} · ${formatDate(a.at, tz)}`}
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
        // Compact on phones — four of these render as a 2×2 strip there.
        "rounded-lg border bg-card px-3 py-3 sm:px-5 sm:py-4",
        tone === "warning"
          ? "border-amber-200 dark:border-amber-900/40"
          : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span
          className="hidden h-8 w-8 items-center justify-center rounded-lg sm:flex"
          style={{
            backgroundColor: `var(--brand-light, rgba(99,102,241,0.1))`,
            color: `var(--brand, #6366f1)`,
          }}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">
        {value}
      </p>
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

function EmptyMini({ icon, text }: { icon: React.ReactNode; text: string }) {
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
function startOfDayInTz(d: Date, tz: string): Date {
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  const utcRepr = new Date(
    utcMidnight.toLocaleString("en-US", { timeZone: "UTC" }),
  );
  const tzRepr = new Date(utcMidnight.toLocaleString("en-US", { timeZone: tz }));
  return new Date(utcMidnight.getTime() + (utcRepr.getTime() - tzRepr.getTime()));
}

function endOfDayInTz(d: Date, tz: string): Date {
  return new Date(startOfDayInTz(d, tz).getTime() + 24 * 60 * 60 * 1000 - 1);
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
