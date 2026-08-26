import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Match stray punches — closed time entries with no booking — against jobs
 * the same person was ASSIGNED to whose scheduled window overlaps the punch.
 *
 * This is the healing tool for hours that exist but point at nothing:
 * Marharyta's twelve "manager" entries each sat squarely inside one of her
 * assigned jobs' windows. The rebuilt clock makes new strays rare; this
 * cleans up the ones that still happen (and the history).
 *
 * Deliberately deterministic and deliberately assigned-only: the schedule IS
 * the signal, and a suggestion for a job the person wasn't assigned to would
 * be a guess. Suggestions are surfaced, never auto-applied — attaching is a
 * human tap (the clock rebuild's doctrine: nothing arbitrary, intentional).
 */

export type AttachCandidate = {
  bookingId: string;
  clientName: string;
  scheduledAt: string;
  serviceLabel: string | null;
  overlapMinutes: number;
  /** How many candidates cleared the bar — >1 means "best of several". */
  candidateCount: number;
};

type StrayEntry = {
  id: string;
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  booking_id: string | null;
};

const MIN_OVERLAP_RATIO = 0.5;

export async function matchStrayEntries(
  db: SupabaseClient,
  entries: StrayEntry[],
): Promise<Map<string, AttachCandidate>> {
  const out = new Map<string, AttachCandidate>();
  const strays = entries.filter((e) => !e.booking_id && e.clock_out_at);
  if (strays.length === 0) return out;

  const employeeIds = [...new Set(strays.map((e) => e.employee_id))];
  const windowStart = new Date(
    Math.min(...strays.map((e) => Date.parse(e.clock_in_at))) - 4 * 3_600_000,
  ).toISOString();
  const windowEnd = new Date(
    Math.max(...strays.map((e) => Date.parse(e.clock_out_at as string))) +
      4 * 3_600_000,
  ).toISOString();

  // Assigned = primary slot or crew junction. Cancelled jobs never count;
  // completed ones absolutely do — a stray punch usually belongs to a job
  // that got finished.
  const [{ data: primary }, { data: junction }] = await Promise.all([
    db
      .from("bookings")
      .select(
        "id, assigned_to, scheduled_at, duration_minutes, service_type, service_type_label, status, client:clients ( name )",
      )
      .in("assigned_to", employeeIds)
      .gte("scheduled_at", windowStart)
      .lte("scheduled_at", windowEnd)
      .neq("status", "cancelled") as unknown as Promise<{
      data: BookingRow[] | null;
    }>,
    db
      .from("booking_assignees" as never)
      .select(
        "membership_id, booking:bookings!inner ( id, assigned_to, scheduled_at, duration_minutes, service_type, service_type_label, status, client:clients ( name ) )",
      )
      .in("membership_id" as never, employeeIds as never)
      // Bounded at the database — the JS re-filter below is belt, this is
      // braces. Unbounded, this pulled every assignment the person ever had.
      .gte("booking.scheduled_at" as never, windowStart as never)
      .lte("booking.scheduled_at" as never, windowEnd as never)
      .neq("booking.status" as never, "cancelled" as never) as unknown as Promise<{
      data: Array<{ membership_id: string; booking: BookingRow | null }> | null;
    }>,
  ]);

  type BookingRow = {
    id: string;
    assigned_to: string | null;
    scheduled_at: string;
    duration_minutes: number | null;
    service_type: string | null;
    service_type_label: string | null;
    status: string;
    client: { name: string } | null;
  };

  // employee -> their assigned bookings in the window
  const byEmployee = new Map<string, BookingRow[]>();
  const add = (empId: string, b: BookingRow) => {
    if (b.status === "cancelled") return;
    const t = Date.parse(b.scheduled_at);
    if (
      !Number.isFinite(t) ||
      b.scheduled_at < windowStart ||
      b.scheduled_at > windowEnd
    )
      return;
    const list = byEmployee.get(empId) ?? [];
    if (!list.some((x) => x.id === b.id)) list.push(b);
    byEmployee.set(empId, list);
  };
  for (const b of primary ?? []) {
    if (b.assigned_to) add(b.assigned_to, b);
  }
  for (const r of junction ?? []) {
    if (r.booking) add(r.membership_id, r.booking);
  }

  for (const e of strays) {
    const jobs = byEmployee.get(e.employee_id) ?? [];
    const inMs = Date.parse(e.clock_in_at);
    const outMs = Date.parse(e.clock_out_at as string);
    // A reversed or zero-length entry would make the overlap bar trivially
    // clearable (max(1, negative) = 1 minute) — skip rather than suggest.
    if (!(outMs > inMs)) continue;
    const entryMin = Math.max(1, (outMs - inMs) / 60_000);

    let best: AttachCandidate | null = null;
    let count = 0;
    for (const b of jobs) {
      const schedStart = Date.parse(b.scheduled_at);
      const schedEnd = schedStart + (b.duration_minutes ?? 120) * 60_000;
      const overlapMs =
        Math.min(outMs, schedEnd) - Math.max(inMs, schedStart);
      const overlapMin = overlapMs / 60_000;
      if (overlapMin < entryMin * MIN_OVERLAP_RATIO) continue;
      count++;
      if (!best || overlapMin > best.overlapMinutes) {
        best = {
          bookingId: b.id,
          clientName: b.client?.name ?? "Job",
          scheduledAt: b.scheduled_at,
          serviceLabel: b.service_type_label ?? b.service_type,
          overlapMinutes: Math.round(overlapMin),
          candidateCount: 0,
        };
      }
    }
    if (best) {
      best.candidateCount = count;
      out.set(e.id, best);
    }
  }
  return out;
}
