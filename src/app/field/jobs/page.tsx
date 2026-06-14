import { requireMembership } from "@/lib/auth";
import { FieldHeader } from "@/components/field-shell";
import { fetchMyFieldJobs, localDate, isStarted } from "./data";
import { JobCard } from "./job-card";

export const metadata = { title: "Today" };

/**
 * "Today" — the active-work screen. Shows everything scheduled today, plus
 * anything already started (en route / in progress) and any overdue job
 * that hasn't been completed, so nothing in-flight slips off.
 */
export default async function FieldTodayPage() {
  const membership = await requireMembership();
  const { jobs, tz } = await fetchMyFieldJobs(membership);
  const todayStr = localDate(new Date().toISOString(), tz);

  const todayJobs = jobs.filter((j) => {
    const d = localDate(j.effective_scheduled_at, tz);
    if (isStarted(j.status)) return true; // started, even if it ran late
    if (d === todayStr) return true; // scheduled today (incl. completed today)
    if (d < todayStr && j.status !== "completed") return true; // overdue, not done
    return false;
  });

  // Group by day so an overdue job from an earlier date is clearly labelled.
  const groups = new Map<string, typeof todayJobs>();
  for (const job of todayJobs) {
    const key = new Date(job.effective_scheduled_at).toLocaleDateString(
      "en-US",
      { weekday: "long", month: "short", day: "numeric" },
    );
    const arr = groups.get(key) ?? [];
    arr.push(job);
    groups.set(key, arr);
  }

  return (
    <>
      <FieldHeader title="Today" description="Your active jobs for today." />

      {todayJobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
          Nothing on today. Check the Shifts tab for what&rsquo;s coming up.
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
