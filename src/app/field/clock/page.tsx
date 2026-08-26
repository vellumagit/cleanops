import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { formatDateTime, formatDurationMinutes } from "@/lib/format";
import { ClockCard } from "./clock-card";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Clock" };

function diffMinutes(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

export default async function FieldClockPage() {
  const membership = await requireMembership();
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();

  const since = new Date();
  since.setDate(since.getDate() - 7);

  // Today's assigned jobs, so clocking in is a one-tap intentional choice
  // instead of an arbitrary punch. Primary assignment and crew-junction
  // both count — the second cleaner on a split shift is just as assigned.
  const { zonedDayBoundsUtc } = await import("@/lib/wall-clock");
  const { start: dayStart, end: dayEnd } = zonedDayBoundsUtc(new Date(), tz, 0);
  const [{ data: primaryJobs }, { data: crewRows }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, service_type, service_type_label, status, client:clients ( name )",
      )
      .eq("assigned_to", membership.id)
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString())
      .in("status", ["pending", "confirmed", "in_progress"]),
    supabase
      .from("booking_assignees" as never)
      .select(
        "booking:bookings ( id, scheduled_at, service_type, service_type_label, status, client:clients ( name ) )",
      )
      .eq("membership_id" as never, membership.id as never),
  ]);
  type JobRow = {
    id: string;
    scheduled_at: string;
    service_type: string | null;
    service_type_label: string | null;
    status: string;
    client: { name: string } | null;
  };
  const jobMap = new Map<string, JobRow>();
  for (const b of (primaryJobs ?? []) as unknown as JobRow[]) {
    jobMap.set(b.id, b);
  }
  for (const r of (crewRows ?? []) as unknown as Array<{
    booking: JobRow | null;
  }>) {
    const b = r.booking;
    if (!b) continue;
    if (b.scheduled_at < dayStart.toISOString()) continue;
    if (b.scheduled_at >= dayEnd.toISOString()) continue;
    if (!["pending", "confirmed", "in_progress"].includes(b.status)) continue;
    jobMap.set(b.id, b);
  }
  // Rollover prompt: while clocked into job A, the next assigned job whose
  // start has (nearly) arrived gets offered as "finish & start". Only jobs
  // nobody has started — pending/confirmed — qualify as "next".
  const rawJobs = [...jobMap.values()];

  const todaysJobs = rawJobs
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .map((b) => ({
      id: b.id,
      clientName: b.client?.name ?? "Job",
      serviceLabel: b.service_type_label ?? b.service_type ?? "",
      timeLabel: new Date(b.scheduled_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }),
    }));

  const [{ data: open }, { data: history }] = await Promise.all([
    supabase
      .from("time_entries")
      .select(
        "id, clock_in_at, booking:bookings ( id, client:clients ( name ) )",
      )
      .eq("employee_id", membership.id)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("time_entries")
      .select(
        "id, clock_in_at, clock_out_at, booking:bookings ( client:clients ( name ) )",
      )
      .eq("employee_id", membership.id)
      .not("clock_out_at", "is", null)
      .gte("clock_in_at", since.toISOString())
      .order("clock_in_at", { ascending: false })
      .limit(20),
  ]);

  const openBookingLabel = open?.booking?.client?.name ?? null;
  const openBookingId = open?.booking?.id ?? null;

  const soonMs = Date.now() + 10 * 60_000;
  const nextJobRow = openBookingId
    ? rawJobs
        .filter(
          (b) =>
            b.id !== openBookingId &&
            ["pending", "confirmed"].includes(b.status) &&
            Date.parse(b.scheduled_at) <= soonMs,
        )
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0] ?? null
    : null;
  const nextJob = nextJobRow
    ? {
        id: nextJobRow.id,
        clientName: nextJobRow.client?.name ?? "Job",
        serviceLabel:
          nextJobRow.service_type_label ?? nextJobRow.service_type ?? "",
        timeLabel: new Date(nextJobRow.scheduled_at).toLocaleTimeString(
          "en-US",
          { hour: "numeric", minute: "2-digit", timeZone: tz },
        ),
      }
    : null;

  return (
    <>
      <FieldHeader
        title="Clock"
        description="Track your shift. Location is captured at clock-in and out."
      />

      <ClockCard
        elevated={["owner", "admin", "manager"].includes(membership.role)}
        todaysJobs={todaysJobs}
        nextJob={nextJob}
        tz={tz}
        isClockedIn={Boolean(open)}
        openSinceIso={open?.clock_in_at ?? null}
        openBookingLabel={openBookingLabel}
        openBookingId={openBookingId}
      />

      <section className="mt-7">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Last 7 days
          </h2>
          {/* This list is capped at 7 days / 20 rows. Anyone checking a pay
              period or an older shift needs the full history. */}
          <Link
            href="/field/hours"
            className="text-xs font-semibold text-primary underline-offset-2 transition-opacity hover:underline active:underline active:opacity-70"
          >
            All my hours →
          </Link>
        </div>
        {!history || history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            No completed shifts yet this week.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {history.map((entry) => {
              const minutes =
                entry.clock_out_at && entry.clock_in_at
                  ? diffMinutes(entry.clock_in_at, entry.clock_out_at)
                  : 0;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">
                      {entry.booking?.client?.name ?? "Generic shift"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(entry.clock_in_at, tz)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-semibold tabular-nums">
                      {formatDurationMinutes(minutes)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
