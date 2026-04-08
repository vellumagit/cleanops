import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  addDays,
  fetchScheduleWeek,
  formatWeekParam,
  parseWeekParam,
  startOfWeek,
} from "./data";
import { WeekGrid } from "./week-grid";

export const metadata = { title: "Scheduling" };

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const { week } = await searchParams;
  const weekStart = parseWeekParam(week);
  const { bookings, employees } = await fetchScheduleWeek(weekStart);

  const prev = formatWeekParam(addDays(weekStart, -7));
  const next = formatWeekParam(addDays(weekStart, 7));
  const today = formatWeekParam(startOfWeek(new Date()));

  const weekEnd = addDays(weekStart, 6);
  const range = `${weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} – ${weekEnd.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  return (
    <PageShell
      title="Scheduling"
      description="Drag bookings between cleaners and days. Conflicts are flagged automatically."
      actions={
        <div className="flex items-center gap-1">
          <Link
            href={`/app/scheduling?week=${prev}`}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={`/app/scheduling?week=${today}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            This week
          </Link>
          <Link
            href={`/app/scheduling?week=${next}`}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-sm font-medium text-muted-foreground">{range}</div>
        <WeekGrid
          weekStart={formatWeekParam(weekStart)}
          bookings={bookings}
          employees={employees}
          canEdit={canEdit}
        />
      </div>
    </PageShell>
  );
}
