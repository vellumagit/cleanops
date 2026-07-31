import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { formatDurationMinutes, humanizeEnum } from "@/lib/format";
import { getOrgTimezone } from "@/lib/org-timezone";
import { resolveShiftWindows, shiftWindowKey } from "@/lib/crew-hours";
import { closedEntryOverrunMinutes } from "@/lib/shift-overrun";

export const metadata = { title: "My hours" };

type PeriodKey = "this_week" | "last_week" | "last_30" | "last_90";

const PERIODS: Array<{ key: PeriodKey; label: string; days: number }> = [
  { key: "this_week", label: "This week", days: 0 },
  { key: "last_week", label: "Last week", days: 0 },
  { key: "last_30", label: "30 days", days: 30 },
  { key: "last_90", label: "90 days", days: 90 },
];

/** Monday-start week containing `d`, in the org's timezone. */
function startOfWeek(d: Date, tz: string): Date {
  const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  const dow = (local.getDay() + 6) % 7; // Mon = 0
  local.setDate(local.getDate() - dow);
  local.setHours(0, 0, 0, 0);
  return local;
}

function resolveRange(period: PeriodKey, tz: string): { from: Date; to: Date } {
  const now = new Date();
  if (period === "this_week") {
    return { from: startOfWeek(now, tz), to: now };
  }
  if (period === "last_week") {
    const thisWeek = startOfWeek(now, tz);
    const from = new Date(thisWeek);
    from.setDate(from.getDate() - 7);
    return { from, to: thisWeek };
  }
  const days = period === "last_90" ? 90 : 30;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from, to: now };
}

function minutesBetween(a: string, b: string): number {
  return Math.max(
    0,
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000),
  );
}

/**
 * "My hours" — an employee's own shift history.
 *
 * The Clock tab showed the last 7 days capped at 20 rows and nothing else, so
 * a cleaner had no way to check a shift from three weeks ago or add up a pay
 * period. That matters most exactly where trust is thinnest: the shifts the
 * system capped or flagged. Those are marked here in the cleaner's own view,
 * with the same numbers the office sees on the timesheet, rather than being
 * visible only to the office.
 */
export default async function FieldHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);

  const raw = (await searchParams).period;
  const period: PeriodKey = PERIODS.some((p) => p.key === raw)
    ? (raw as PeriodKey)
    : "this_week";
  const { from, to } = resolveRange(period, tz);

  const { data: entries } = (await supabase
    .from("time_entries")
    .select(
      `id, clock_in_at, clock_out_at, work_category, needs_review, auto_closed_at,
       booking:bookings (
         id, scheduled_at, duration_minutes, service_type,
         client:clients ( name )
       )`,
    )
    .eq("employee_id", membership.id)
    .gte("clock_in_at", from.toISOString())
    .lt("clock_in_at", to.toISOString())
    .order("clock_in_at", { ascending: false })
    .limit(400)) as unknown as {
    data: Array<{
      id: string;
      clock_in_at: string;
      clock_out_at: string | null;
      work_category: string | null;
      needs_review: boolean | null;
      auto_closed_at: string | null;
      booking: {
        id: string;
        scheduled_at: string;
        duration_minutes: number | null;
        service_type: string | null;
        client: { name: string | null } | null;
      } | null;
    }> | null;
  };

  const rows = entries ?? [];

  // Same per-person allotment the office timesheet and the clock-out cron
  // use, so a cleaner never sees a different overrun than their manager.
  const shiftWindows = await resolveShiftWindows(
    Array.from(
      new Map(
        rows
          .filter((r) => r.booking?.id)
          .map((r) => [
            r.booking!.id,
            {
              id: r.booking!.id,
              duration_minutes: r.booking!.duration_minutes ?? null,
            },
          ]),
      ).values(),
    ),
  );

  const enriched = rows.map((r) => {
    const minutes = r.clock_out_at
      ? minutesBetween(r.clock_in_at, r.clock_out_at)
      : 0;
    // This cleaner's own window — on a split shift their segment starts
    // hours after the booking does, and using the booking's start told
    // people they ran over when they had finished early.
    const win = r.booking?.id
      ? shiftWindows.get(shiftWindowKey(r.booking.id, membership.id))
      : undefined;
    const segStartIso =
      win && r.booking?.scheduled_at
        ? new Date(
            new Date(r.booking.scheduled_at).getTime() +
              win.startOffsetMinutes * 60_000,
          ).toISOString()
        : r.booking?.scheduled_at ?? null;
    const over = closedEntryOverrunMinutes({
      clockInIso: r.clock_in_at,
      clockOutIso: r.clock_out_at,
      scheduledStartIso: segStartIso,
      scheduledMinutes:
        win?.allottedMinutes ?? r.booking?.duration_minutes ?? null,
    });
    return { ...r, minutes, over };
  });

  const totalMinutes = enriched.reduce((s, r) => s + r.minutes, 0);
  const openCount = enriched.filter((r) => !r.clock_out_at).length;
  const flaggedCount = enriched.filter(
    (r) => r.needs_review || r.over > 0,
  ).length;

  // Group by local day so a shift reads under the date the person worked it.
  const byDay = new Map<string, typeof enriched>();
  for (const r of enriched) {
    const key = new Date(r.clock_in_at).toLocaleDateString("en-CA", {
      timeZone: tz,
    });
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }

  return (
    <>
      <FieldHeader
        title="My hours"
        description="Every shift you've recorded, and what it added up to."
      />

      <Link
        href="/field/clock"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to clock
      </Link>

      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/field/hours?period=${p.key}`}
            className={
              p.key === period
                ? "rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
                : "rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Total
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums">
          {(totalMinutes / 60).toFixed(1)}h
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {enriched.length} shift{enriched.length === 1 ? "" : "s"}
          {openCount > 0 ? ` · ${openCount} still running` : ""}
        </p>
        {/* Say it plainly rather than leaving them to find out at payday. */}
        {flaggedCount > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/15 px-2 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {flaggedCount} shift{flaggedCount === 1 ? "" : "s"} flagged for
              your manager to confirm. Your hours haven&rsquo;t been changed —
              if something looks wrong, tell them what actually happened.
            </span>
          </p>
        )}
      </div>

      {enriched.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
          No shifts recorded in this period.
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {Array.from(byDay.entries()).map(([day, dayRows]) => {
            const dayMinutes = dayRows.reduce((s, r) => s + r.minutes, 0);
            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </h2>
                  <span className="text-sm font-semibold tabular-nums">
                    {(dayMinutes / 60).toFixed(1)}h
                  </span>
                </div>
                <ul className="space-y-2">
                  {dayRows.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold">
                            {r.booking?.client?.name ??
                              (r.work_category
                                ? humanizeEnum(r.work_category)
                                : "Shift")}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {new Date(r.clock_in_at).toLocaleTimeString(
                              "en-US",
                              {
                                timeZone: tz,
                                hour: "numeric",
                                minute: "2-digit",
                              },
                            )}
                            {" – "}
                            {r.clock_out_at
                              ? new Date(r.clock_out_at).toLocaleTimeString(
                                  "en-US",
                                  {
                                    timeZone: tz,
                                    hour: "numeric",
                                    minute: "2-digit",
                                  },
                                )
                              : "still running"}
                            {r.booking?.service_type
                              ? ` · ${humanizeEnum(r.booking.service_type)}`
                              : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-base font-bold tabular-nums">
                          {r.clock_out_at
                            ? formatDurationMinutes(r.minutes)
                            : "—"}
                        </span>
                      </div>

                      {(r.needs_review || r.over > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.auto_closed_at ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                              Auto clocked-out
                            </span>
                          ) : r.needs_review ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                              Needs review
                            </span>
                          ) : null}
                          {r.over > 0 && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300">
                              {formatDurationMinutes(r.over)} over the job
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
