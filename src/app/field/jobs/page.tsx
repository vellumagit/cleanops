import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";

export const metadata = { title: "My jobs" };

export default async function FieldJobsPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  // Show jobs assigned to this member from yesterday onwards so an in-progress
  // overnight job doesn't disappear.
  const since = new Date();
  since.setDate(since.getDate() - 1);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `
        id,
        scheduled_at,
        duration_minutes,
        status,
        service_type,
        address,
        notes,
        client:clients ( name )
      `,
    )
    .eq("assigned_to", membership.id)
    .gte("scheduled_at", since.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (error) throw error;
  const jobs = data ?? [];

  // Group by calendar day for easier scanning.
  const groups = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = new Date(job.scheduled_at).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const arr = groups.get(key) ?? [];
    arr.push(job);
    groups.set(key, arr);
  }

  return (
    <>
      <FieldHeader
        title="My jobs"
        description="Everything assigned to you, soonest first."
      />

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
          No jobs assigned to you yet. Check back after your manager schedules
          you.
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
                    <Link
                      href={`/field/jobs/${job.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors active:bg-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-semibold">
                            {job.client?.name ?? "—"}
                          </span>
                          <StatusBadge tone={bookingStatusTone(job.status)}>
                            {humanizeEnum(job.status)}
                          </StatusBadge>
                        </div>
                        <div className="mt-1.5 text-sm text-muted-foreground">
                          {formatDateTime(job.scheduled_at)} ·{" "}
                          {formatDurationMinutes(job.duration_minutes)} ·{" "}
                          {humanizeEnum(job.service_type)}
                        </div>
                        {job.address ? (
                          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="line-clamp-1">{job.address}</span>
                          </div>
                        ) : null}
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    </Link>
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
