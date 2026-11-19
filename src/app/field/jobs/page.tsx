import Link from "next/link";
import { ChevronRight, ListChecks } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  // Tasks the office has given this person and that aren't done. Shown as
  // one line at the top of Today, the screen a cleaner actually opens; a
  // row on the Profile tab alone would be found by nobody.
  const supabase = await createSupabaseServerClient();
  const { count: openTasks } = (await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", membership.organization_id)
    .eq("assigned_to", membership.id)
    .is("completed_at", null)) as unknown as { count: number | null };

  const todayJobs = jobs.filter((j) => {
    const d = localDate(j.effective_scheduled_at, tz);
    if (isStarted(j.status)) return true; // started, even if it ran late
    if (d === todayStr) return true; // scheduled today (incl. completed today)
    if (d < todayStr && j.status !== "completed") return true; // overdue, not done
    return false;
  });

  // Group by day so an overdue job from an earlier date is clearly labelled.
  // A job today that still needs the cleaner's yes is the one thing on this
  // screen that can go wrong by being missed. It goes first.
  todayJobs.sort((a, b) => {
    if (a.needs_acceptance !== b.needs_acceptance) return a.needs_acceptance ? -1 : 1;
    return a.effective_scheduled_at.localeCompare(b.effective_scheduled_at);
  });
  const groups = new Map<string, typeof todayJobs>();
  for (const job of todayJobs) {
    // Same timezone as the filter three lines up, which uses localDate(…, tz).
    // Without it the heading rendered in the SERVER's zone — UTC on Vercel —
    // so an Edmonton job at or after 6 PM was filed under tomorrow's heading
    // while the card beneath it printed today's time.
    const key = new Date(job.effective_scheduled_at).toLocaleDateString(
      "en-US",
      { weekday: "long", month: "short", day: "numeric", timeZone: tz },
    );
    const arr = groups.get(key) ?? [];
    arr.push(job);
    groups.set(key, arr);
  }

  return (
    <>
      <FieldHeader title="Today" description="Your active jobs for today." />

      {openTasks ? (
        <Link
          href="/field/tasks"
          data-testid="my-tasks-link"
          className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors active:bg-muted"
        >
          <ListChecks className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-[15px] font-medium">
            {openTasks === 1 ? "1 task from the office" : `${openTasks} tasks from the office`}
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}

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
