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
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "My jobs" };

// TEMP DIAGNOSTIC: tracks where in the render chain we crash so the
// error.tsx fallback doesn't swallow the actual cause. Increment the
// stage variable as each step succeeds; on catch, surface stage +
// error text on screen so the user can paste it back. Remove after
// the field/jobs regression is root-caused.
export default async function FieldJobsPage() {
  let stage = "init";
  try {
    stage = "requireMembership";
    const membership = await requireMembership();
    stage = "createSupabaseServerClient";
    const supabase = await createSupabaseServerClient();
    stage = "getOrgTimezone";
    const tz = await getOrgTimezone(membership.organization_id);

  // Show jobs assigned to this member from yesterday onwards so an in-progress
  // overnight job doesn't disappear.
  const since = new Date();
  since.setDate(since.getDate() - 1);
  since.setHours(0, 0, 0, 0);

  // Step 1: get this member's assignee rows (with split metadata).
  // We avoid filtering on the embedded booking here — PostgREST embedded
  // filters were causing intermittent failures on this route.
    stage = "booking_assignees query";
  const assigneeResp = (await supabase
    .from("booking_assignees" as never)
    .select(
      "booking_id, split_start_offset_minutes, split_duration_minutes",
    )
    .eq("membership_id" as never, membership.id as never)) as unknown as {
    data: Array<{
      booking_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
    }> | null;
    error: { message: string } | null;
  };

  if (assigneeResp.error) throw new Error(
    `booking_assignees: ${JSON.stringify(assigneeResp.error)}`,
  );

  const assigneeByBooking = new Map(
    (assigneeResp.data ?? []).map((r) => [r.booking_id, r]),
  );
  const bookingIds = Array.from(assigneeByBooking.keys());

  // Step 2: fetch the actual booking rows in a single query. No more
  // embedded filters — straight SQL on the bookings table.
    stage = `bookings query (${bookingIds.length} ids)`;
  const bookingsResp =
    bookingIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("bookings")
          .select(
            `id, scheduled_at, duration_minutes, status, service_type,
             address, notes, client:clients ( name )`,
          )
          .in("id", bookingIds)
          .gte("scheduled_at", since.toISOString())
          .neq("status", "cancelled")
          .order("scheduled_at", { ascending: true })
          .limit(50);

  if (bookingsResp.error) throw new Error(
    `bookings: ${JSON.stringify(bookingsResp.error)}`,
  );

  const jobs = (bookingsResp.data ?? []).map((b) => {
    const seg = assigneeByBooking.get(b.id);
    const offset = seg?.split_start_offset_minutes ?? null;
    const segDur = seg?.split_duration_minutes ?? null;
    return {
      ...b,
      effective_scheduled_at:
        offset != null
          ? new Date(
              new Date(b.scheduled_at).getTime() + offset * 60_000,
            ).toISOString()
          : b.scheduled_at,
      effective_duration_minutes: segDur ?? b.duration_minutes,
    };
  });
  jobs.sort(
    (a, b) =>
      new Date(a.effective_scheduled_at).getTime() -
      new Date(b.effective_scheduled_at).getTime(),
  );

  // Group by calendar day for easier scanning.
  const groups = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = new Date(job.effective_scheduled_at).toLocaleDateString("en-US", {
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
                          <StatusBadge
                            tone={bookingStatusTone(
                              job.status as
                                | "pending"
                                | "confirmed"
                                | "en_route"
                                | "in_progress"
                                | "completed"
                                | "cancelled",
                            )}
                          >
                            {humanizeEnum(job.status)}
                          </StatusBadge>
                        </div>
                        <div className="mt-1.5 text-sm text-muted-foreground">
                          {formatDateTime(job.effective_scheduled_at, tz)} ·{" "}
                          {formatDurationMinutes(job.effective_duration_minutes)} ·{" "}
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
  } catch (err) {
    // TEMP DIAGNOSTIC — surface the real error instead of letting it
    // get swallowed by /field/error.tsx. Remove once root-caused.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm dark:border-red-900/40 dark:bg-red-950/30">
        <h2 className="mb-2 text-base font-semibold text-red-900 dark:text-red-200">
          Diagnostic — /field/jobs crashed
        </h2>
        <p className="mb-2 text-red-800 dark:text-red-300">
          <strong>Stage:</strong> {stage}
        </p>
        <p className="mb-2 text-red-800 dark:text-red-300">
          <strong>Error:</strong> {msg}
        </p>
        {stack && (
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-red-100 p-2 text-[11px] text-red-900 dark:bg-red-950/50 dark:text-red-200">
            {stack}
          </pre>
        )}
      </div>
    );
  }
}
