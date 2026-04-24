import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOrgTimezone } from "@/lib/org-timezone";
import {
  addDays,
  fetchScheduleWeek,
  fetchSchedulerViews,
  formatWeekParam,
  parseWeekParam,
  startOfWeek,
} from "./data";
import { SchedulerShell } from "./scheduler-shell";

export const metadata = { title: "Scheduling" };

type View = "week" | "day";

function parseView(raw: string | undefined): View {
  return raw === "day" ? "day" : "week";
}

/**
 * Convert a YYYY-MM-DD string to the UTC Date that represents midnight
 * of that local date in the given IANA timezone. The scheduler fetch
 * range must be tz-aware or late-evening bookings fall into the next
 * UTC day and get dropped from Day view (where the fetch window is
 * only 24 hours).
 *
 * How it works: interpret the YYYY-MM-DD as if it were UTC (giving
 * us a "naive" reference instant), format THAT instant in the target
 * tz, compute the offset between the naive UTC and what the target
 * tz displayed, then shift the naive UTC back by that offset so the
 * result lands on the correct wall-clock in the target tz.
 */
function midnightInTzUtc(dateYmd: string, tz: string): Date {
  const naiveUtc = new Date(`${dateYmd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(naiveUtc);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const shown = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = shown - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offsetMs);
}

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const tz = await getOrgTimezone(membership.organization_id);
  const { week, view: viewRaw } = await searchParams;
  const view = parseView(viewRaw);

  // Day view treats ?week as the target DAY (not a Monday), and shows
  // just that one date. Week view expands to the containing Mon-Sun.
  // Using the same param keeps the nav URLs simple.
  const weekStart =
    view === "day"
      ? (week && /^\d{4}-\d{2}-\d{2}$/.test(week)
          ? (() => {
              const [y, m, d] = week.split("-").map(Number);
              return new Date(y, m - 1, d);
            })()
          : new Date(new Date().setHours(0, 0, 0, 0)))
      : parseWeekParam(week);

  // TZ-aware fetch range. `weekStart` is a local-midnight Date object
  // (UTC midnight on Vercel); passing .toISOString() of that to the DB
  // query means we fetch `UTC-day`, not `org-tz-day`. For an Edmonton
  // org (UTC-6), a 22:00-Edmonton booking lives at 04:00 UTC the
  // NEXT day — so Day view's UTC-bounded fetch misses it entirely.
  // Convert the requested YYYY-MM-DD to the UTC instant that
  // corresponds to midnight in the org's tz before querying.
  const weekStartYmd = formatWeekParam(weekStart);
  const weekEndExclusive = addDays(weekStart, view === "day" ? 1 : 7);
  const weekEndYmd = formatWeekParam(weekEndExclusive);
  const fetchStart = midnightInTzUtc(weekStartYmd, tz);
  const fetchEnd = midnightInTzUtc(weekEndYmd, tz);

  const [
    { bookings, employees, offDays },
    savedViews,
  ] = await Promise.all([
    fetchScheduleWeek(fetchStart, fetchEnd, {
      startYmd: weekStartYmd,
      endYmdExclusive: weekEndYmd,
    }),
    fetchSchedulerViews(membership.organization_id),
  ]);

  const navStep = view === "day" ? 1 : 7;
  const prev = formatWeekParam(addDays(weekStart, -navStep));
  const next = formatWeekParam(addDays(weekStart, navStep));
  const today =
    view === "day"
      ? formatWeekParam(new Date(new Date().setHours(0, 0, 0, 0)))
      : formatWeekParam(startOfWeek(new Date()));

  const weekEnd = addDays(weekStart, view === "day" ? 0 : 6);
  const range =
    view === "day"
      ? weekStart.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : `${weekStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })} – ${weekEnd.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`;

  const descriptions: Record<View, string> = {
    week: "Drag bookings between cleaners and days. Click a card for details.",
    day: "Dispatch view — 30-min slots with an employee column per cleaner. Click an empty slot to create, click a card to edit, drag the grip to move.",
  };

  const tabLinkClass = (active: boolean) =>
    cn(
      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-background text-foreground shadow-sm border border-border"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <PageShell
      title="Scheduling"
      description={descriptions[view]}
      actions={
        <div className="flex items-center gap-1">
          <Link
            href={`/app/scheduling?view=${view}&week=${prev}`}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label={view === "day" ? "Previous day" : "Previous week"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={`/app/scheduling?view=${view}&week=${today}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {view === "day" ? "Today" : "This week"}
          </Link>
          <Link
            href={`/app/scheduling?view=${view}&week=${next}`}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label={view === "day" ? "Next day" : "Next week"}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-muted-foreground">
            {range}
          </div>
          {/* View toggle — owners frequently asked for alternate views.
              Week stays the default (broad planning); Day zooms in on
              a single date for morning stand-ups or tight mornings. */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
            <Link
              href={`/app/scheduling?view=week&week=${formatWeekParam(startOfWeek(weekStart))}`}
              className={tabLinkClass(view === "week")}
            >
              Week
            </Link>
            <Link
              href={`/app/scheduling?view=day&week=${formatWeekParam(weekStart)}`}
              className={tabLinkClass(view === "day")}
            >
              Day
            </Link>
          </div>
        </div>
        <SchedulerShell
          view={view}
          weekStart={formatWeekParam(weekStart)}
          bookings={bookings}
          employees={employees}
          offDays={offDays}
          canEdit={canEdit}
          tz={tz}
          savedViews={savedViews}
        />
      </div>
    </PageShell>
  );
}
