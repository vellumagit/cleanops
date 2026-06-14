import { CalendarClock } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { FieldHeader } from "@/components/field-shell";
import { fetchMyFieldJobs, localDate } from "../jobs/data";
import { JobCard } from "../jobs/job-card";

export const metadata = { title: "Shifts" };

/**
 * "Shifts" — upcoming assigned work (future days). This is where the cleaner
 * confirms pending shifts and sees what's coming. Today + in-progress live
 * on the Today tab.
 */
export default async function FieldShiftsPage() {
  const membership = await requireMembership();
  const { jobs, tz } = await fetchMyFieldJobs(membership);
  const todayStr = localDate(new Date().toISOString(), tz);

  const upcoming = jobs.filter((j) => {
    const d = localDate(j.effective_scheduled_at, tz);
    return d > todayStr && j.status !== "completed";
  });

  const groups = new Map<string, typeof upcoming>();
  for (const job of upcoming) {
    const key = new Date(job.effective_scheduled_at).toLocaleDateString(
      "en-US",
      { weekday: "long", month: "short", day: "numeric" },
    );
    const arr = groups.get(key) ?? [];
    arr.push(job);
    groups.set(key, arr);
  }

  const pendingCount = upcoming.filter((j) => j.needs_acceptance).length;

  return (
    <>
      <FieldHeader
        title="Upcoming shifts"
        description="What's scheduled ahead — confirm the ones that need it."
      />

      {pendingCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <CalendarClock className="h-4 w-4 shrink-0" />
          {pendingCount} shift{pendingCount === 1 ? "" : "s"} need
          {pendingCount === 1 ? "s" : ""} your confirmation — tap a highlighted
          shift to accept.
        </div>
      )}

      {upcoming.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
          No upcoming shifts scheduled. Your manager will assign you soon.
        </div>
      ) : (
        <div className="space-y-7">
          {Array.from(groups.entries()).map(([day, dayJobs]) => (
            <section key={day}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {day}
              </h2>
              <ul className="space-y-3">
                {dayJobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} tz={tz} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
