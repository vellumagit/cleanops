/**
 * "This job doesn't look right" — computed entirely from rows the bookings
 * page has already loaded, so every warning here is free: no query, no
 * network, no server work.
 *
 * Design rule: a badge that is always on is invisible. Every condition below
 * is one that is almost always a genuine mistake on healthy data. Deliberately
 * NOT included: plain "unassigned" (normal for bench-bound work), "$0 total"
 * on time-and-materials jobs (legitimately priced by the hour), and
 * "past-dated but still confirmed" on its own (fires on every historical row
 * for orgs that don't auto-complete).
 */

export type BookingWarningCode =
  | "double_booked"
  | "never_staffed"
  | "unassigned_soon"
  | "stuck_in_progress"
  | "no_price"
  | "possible_duplicate";

export type BookingWarning = {
  code: BookingWarningCode;
  /** Chip text — must fit beside the client name. */
  label: string;
  /** Tooltip: what's wrong and what to do about it. */
  detail: string;
  severity: "high" | "medium";
};

/** The subset of a booking row these checks need. */
export type WarnableBooking = {
  id: string;
  client_id: string | null;
  client_name: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  total_cents: number;
  hourly_rate_cents: number | null;
  assigned_to: string | null;
  additional_assignee_ids: string[];
  covered_by_name: string | null;
  /** membership_id → that person's segment of a split shift, when the job is
   *  one. Omitted for the callers that don't load it; those keep the old
   *  whole-booking behaviour. */
  assignee_segments?: Record<
    string,
    { start_offset_minutes: number; duration_minutes: number }
  > | null;
};

const HOUR = 3_600_000;
/** Grace before a past job counts as neglected rather than just finished. */
const PAST_GRACE_MS = 12 * HOUR;
const TERMINAL = new Set(["completed", "cancelled"]);

/**
 * Staffing, matching the engine's rule: an assigned member, OR crew, OR a
 * claimed bench offer. Checking `assigned_to` alone reports crew-only and
 * bench-covered jobs as empty — a false positive the list already shows today.
 */
function isStaffed(b: WarnableBooking): boolean {
  return (
    Boolean(b.assigned_to) ||
    b.additional_assignee_ids.length > 0 ||
    Boolean(b.covered_by_name)
  );
}

function endMs(b: WarnableBooking): number {
  return (
    new Date(b.scheduled_at).getTime() + (b.duration_minutes || 0) * 60_000
  );
}

/**
 * One person's window on a booking.
 *
 * On a SPLIT shift that is their segment, not the whole job — Maria works
 * 9–12 and Ana takes 12–3. Measuring the full booking for both made the two
 * halves of one deliberate hand-off report as a double-booking, and made
 * either cleaner look busy for hours on both sides of the part they actually
 * work, so a genuinely free slot read as occupied.
 */
function memberWindow(
  b: WarnableBooking,
  memberId: string,
): { start: number; end: number } {
  const seg = b.assignee_segments?.[memberId];
  const start =
    new Date(b.scheduled_at).getTime() +
    (seg?.start_offset_minutes ?? 0) * 60_000;
  return {
    start,
    end: start + (seg?.duration_minutes ?? b.duration_minutes ?? 0) * 60_000,
  };
}

/**
 * Warnings for every booking, keyed by id. Cross-row checks (double-booking,
 * duplicates) need the whole set, so this takes the list rather than one row.
 */
export function computeBookingWarnings(
  bookings: WarnableBooking[],
  now: number = Date.now(),
): Map<string, BookingWarning[]> {
  const out = new Map<string, BookingWarning[]>();
  const add = (id: string, w: BookingWarning) => {
    const list = out.get(id) ?? [];
    list.push(w);
    out.set(id, list);
  };

  // ---- Cross-row: one person on two jobs at once ----
  // Nothing in the write path prevents this; the owner hit it in production
  // with a 9:00 and a 10:00 job for the same cleaner on the same morning.
  const byMember = new Map<string, WarnableBooking[]>();
  for (const b of bookings) {
    if (TERMINAL.has(b.status)) continue;
    const crew = [b.assigned_to, ...b.additional_assignee_ids].filter(
      (x): x is string => Boolean(x),
    );
    for (const m of new Set(crew)) {
      byMember.set(m, [...(byMember.get(m) ?? []), b]);
    }
  }
  const conflicted = new Map<string, string>(); // bookingId -> other client
  for (const [memberId, list] of byMember) {
    const sorted = list
      .map((b) => ({ b, ...memberWindow(b, memberId) }))
      .sort((x, y) => x.start - y.start);
    // Compare every later job that could still overlap, not just the next
    // one: a long morning job can run past a short job into a third.
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        // Zero-length windows can't overlap; touching edges are fine.
        if (b.start >= a.end) break;
        if (b.end > a.start) {
          conflicted.set(a.b.id, b.b.client_name);
          conflicted.set(b.b.id, a.b.client_name);
        }
      }
    }
  }
  for (const [id, other] of conflicted) {
    add(id, {
      code: "double_booked",
      label: "Double-booked",
      detail: `The same person is also booked for ${other} at an overlapping time. One of these needs a different cleaner or a different slot.`,
      severity: "high",
    });
  }

  // ---- Cross-row: same client, same minute ----
  const byClientTime = new Map<string, WarnableBooking[]>();
  for (const b of bookings) {
    if (TERMINAL.has(b.status) || !b.client_id) continue;
    const key = `${b.client_id}|${b.scheduled_at}`;
    byClientTime.set(key, [...(byClientTime.get(key) ?? []), b]);
  }
  for (const list of byClientTime.values()) {
    if (list.length < 2) continue;
    for (const b of list) {
      add(b.id, {
        code: "possible_duplicate",
        label: "Possible duplicate",
        detail: `${list.length} bookings exist for this client at exactly this time. Double-submitting the form or regenerating a series can do this — it double-books the crew and double-bills the client.`,
        severity: "high",
      });
    }
  }

  // ---- Per-row ----
  for (const b of bookings) {
    const staffed = isStaffed(b);
    const start = new Date(b.scheduled_at).getTime();
    const finished = endMs(b);

    if (!TERMINAL.has(b.status) && !staffed && finished < now - PAST_GRACE_MS) {
      add(b.id, {
        code: "never_staffed",
        label: "Never staffed",
        detail:
          "This job's time has passed and nobody was ever assigned — no employee, no crew, no bench claim. It was deliberately NOT auto-completed or invoiced. Check whether it happened, then close it out.",
        severity: "high",
      });
    } else if (
      !TERMINAL.has(b.status) &&
      !staffed &&
      start > now &&
      start < now + 24 * HOUR
    ) {
      add(b.id, {
        code: "unassigned_soon",
        label: "Starts soon · no one assigned",
        detail:
          "This job starts within 24 hours and has nobody on it. Assign someone or send it to the bench.",
        severity: "high",
      });
    }

    if (b.status === "in_progress" && finished < now - PAST_GRACE_MS) {
      add(b.id, {
        code: "stuck_in_progress",
        label: "Still in progress",
        detail:
          "This job has been marked in progress since well after it should have finished — usually a crew that clocked in and never closed out. Their hours are still running.",
        severity: "medium",
      });
    }

    // A $0 job never generates an invoice. Legitimate only for
    // time-and-materials work, which carries an hourly rate instead.
    if (
      !TERMINAL.has(b.status) &&
      b.total_cents === 0 &&
      (b.hourly_rate_cents ?? 0) === 0
    ) {
      add(b.id, {
        code: "no_price",
        label: "No price",
        detail:
          "This job has no price and no hourly rate, so it will never produce an invoice. Add a price before it completes.",
        severity: "medium",
      });
    }
  }

  return out;
}
