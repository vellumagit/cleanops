import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addDays,
  fetchScheduleWeek,
  formatWeekParam,
  parseWeekParam,
  startOfWeek,
} from "./data";
import { WeekGrid } from "./week-grid";

export const metadata = { title: "Scheduling" };

type View = "week" | "day";

function parseView(raw: string | undefined): View {
  return raw === "day" ? "day" : "week";
}

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
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

  const fetchStart = weekStart;
  const fetchEnd =
    view === "day" ? addDays(weekStart, 1) : addDays(weekStart, 7);
  const { bookings, employees } = await fetchScheduleWeek(
    fetchStart,
    fetchEnd,
  );

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
    day: "One-day focus view. Click a card for details, drag to reschedule.",
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
        <WeekGrid
          weekStart={formatWeekParam(weekStart)}
          bookings={bookings}
          employees={employees}
          canEdit={canEdit}
          view={view}
        />
      </div>
    </PageShell>
  );
}
