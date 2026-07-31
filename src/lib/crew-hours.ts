import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";

/**
 * A short client-facing note for a divided team booking, e.g.
 * "2 cleaners — finishing around 6:30 PM". Returns undefined when the booking
 * isn't divided, so callers only add it when relevant.
 */
export function crewFinishNote(
  div: TeamDivision,
  scheduledAtIso: string,
  tz: string,
): string | undefined {
  if (!div.divideOn) return undefined;
  const end = new Date(
    new Date(scheduledAtIso).getTime() + div.effectiveMinutes * 60_000,
  );
  const endStr = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return `${div.crewCount} cleaners — finishing around ${endStr}`;
}

export type TeamDivision = {
  /** Number of assignees on the booking. */
  crewCount: number;
  /** True when the divide-hours behavior is active for this booking. */
  divideOn: boolean;
  /** Duration each cleaner is actually on site (== round(full / crew) when
   *  divideOn, else the full duration). Never persisted — always derived. */
  effectiveMinutes: number;
};

/**
 * SINGLE SOURCE OF TRUTH for "divide the job's hours across the crew".
 *
 * For a TEAM job (cleaners working the same window together), returns how long
 * each cleaner is actually on site:
 *   effectiveMinutes = round(fullMinutes / crewCount)  when divide is on and
 *                      2+ crew are assigned, else fullMinutes.
 *
 * "Divide is on" = the booking's own divide_hours_evenly flag OR the org-level
 * `divide_crew_hours` automation toggle — exactly the rule the field app uses,
 * so the field app, both Google Calendars, and client emails can never
 * disagree.
 *
 * IMPORTANT: callers must NOT use this for SPLIT shifts (sequential hand-offs).
 * Those carry their own per-segment durations; gate on split_count/segment
 * metadata before calling. This helper only models same-time team jobs.
 *
 * Best-effort reads: on any query hiccup it degrades to "no division"
 * (effectiveMinutes = fullMinutes) rather than throwing, so a calendar sync is
 * never blocked by this lookup.
 */
export async function resolveTeamDivision(
  bookingId: string,
  fullMinutes: number,
): Promise<TeamDivision> {
  const noDivide: TeamDivision = {
    crewCount: 0,
    divideOn: false,
    effectiveMinutes: fullMinutes,
  };
  try {
    const db = createSupabaseAdminClient();

    const { data: crewRows } = (await db
      .from("booking_assignees")
      .select("membership_id")
      .eq("booking_id", bookingId)) as unknown as {
      data: Array<{ membership_id: string }> | null;
    };
    const crewCount = (crewRows ?? []).length;
    if (crewCount < 2) return { ...noDivide, crewCount };

    // Per-booking flag first (cheap), then the org toggle. Grab organization_id
    // here too so callers don't have to pass it.
    const { data: bk } = (await db
      .from("bookings" as never)
      .select("divide_hours_evenly, organization_id")
      .eq("id" as never, bookingId as never)
      .maybeSingle()) as unknown as {
      data: {
        divide_hours_evenly: boolean | null;
        organization_id: string;
      } | null;
    };
    if (!bk) return { ...noDivide, crewCount };
    let divideOn = bk.divide_hours_evenly === true;
    if (!divideOn) {
      const { data: org } = (await db
        .from("organizations")
        .select("automation_settings")
        .eq("id", bk.organization_id)
        .maybeSingle()) as unknown as {
        data: {
          automation_settings: Record<
            string,
            { enabled?: boolean } | undefined
          > | null;
        } | null;
      };
      divideOn = resolveAutomationEnabled(
        org?.automation_settings ?? null,
        "divide_crew_hours",
      );
    }

    if (!divideOn) return { ...noDivide, crewCount };
    return {
      crewCount,
      divideOn: true,
      effectiveMinutes: Math.max(1, Math.round(fullMinutes / crewCount)),
    };
  } catch {
    return noDivide;
  }
}

/**
 * Per-PERSON shift window for many bookings at once: when their share starts
 * and how long it is.
 *
 * Keyed by `${bookingId}:${membershipId}` because the answer is not a property
 * of the booking. On a split shift (a sequential hand-off) each cleaner has
 * their own offset and their own length, and a 240-minute job split 120/120
 * is NOT the same as 240 divided by a crew of 2 — the durations coincide but
 * the START TIMES do not, and that difference alone invented a 33-minute
 * overrun for a cleaner who left 87 minutes early.
 *
 * Precedence mirrors src/app/field/jobs/data.ts exactly, because the field
 * card, the office timesheet, /field/hours and the clock-out cron must all
 * produce the same number:
 *   1. a split segment for this member  -> its own offset + duration
 *   2. else the job divides crew hours  -> offset 0, duration / crewCount
 *   3. else                             -> offset 0, full duration
 *
 * Three queries total. Bookings absent from the map get no adjustment, so
 * callers should fall back to the booking's own start and duration.
 */
export type ShiftWindow = {
  /** Minutes after the booking's scheduled_at that this person starts. */
  startOffsetMinutes: number;
  /** This person's own allotment, in minutes. */
  allottedMinutes: number;
};

export function shiftWindowKey(
  bookingId: string,
  membershipId: string,
): string {
  return `${bookingId}:${membershipId}`;
}

export async function resolveShiftWindows(
  bookings: Array<{ id: string; duration_minutes: number | null }>,
): Promise<Map<string, ShiftWindow>> {
  const out = new Map<string, ShiftWindow>();
  const ids = bookings.map((b) => b.id).filter(Boolean);
  if (ids.length === 0) return out;

  try {
    const db = createSupabaseAdminClient();

    const [crewRes, bkRes] = await Promise.all([
      db
        .from("booking_assignees")
        .select(
          "booking_id, membership_id, split_start_offset_minutes, split_duration_minutes",
        )
        .in("booking_id", ids) as unknown as Promise<{
        data: Array<{
          booking_id: string;
          membership_id: string;
          split_start_offset_minutes: number | null;
          split_duration_minutes: number | null;
        }> | null;
        error: { message: string } | null;
      }>,
      db
        .from("bookings" as never)
        .select("id, divide_hours_evenly, organization_id")
        .in("id" as never, ids as never) as unknown as Promise<{
        data: Array<{
          id: string;
          divide_hours_evenly: boolean | null;
          organization_id: string;
        }> | null;
        error: { message: string } | null;
      }>,
    ]);

    // A PostgREST error leaves data null, which would look identical to "this
    // booking has no crew" and silently drop every adjustment. Say so.
    if (crewRes.error || bkRes.error) {
      console.error(
        "[crew-hours] resolveShiftWindows query failed:",
        crewRes.error?.message ?? bkRes.error?.message,
      );
      return out;
    }

    const crewRows = crewRes.data ?? [];
    const crewCount = new Map<string, number>();
    for (const r of crewRows) {
      crewCount.set(r.booking_id, (crewCount.get(r.booking_id) ?? 0) + 1);
    }

    // One org lookup per distinct org, not per booking. In practice these
    // pages are single-org, so this is one query.
    const orgDivide = new Map<string, boolean>();
    for (const orgId of new Set(
      (bkRes.data ?? []).map((b) => b.organization_id),
    )) {
      const { data: org } = (await db
        .from("organizations")
        .select("automation_settings")
        .eq("id", orgId)
        .maybeSingle()) as unknown as {
        data: {
          automation_settings: Record<
            string,
            { enabled?: boolean } | undefined
          > | null;
        } | null;
      };
      orgDivide.set(
        orgId,
        resolveAutomationEnabled(
          org?.automation_settings ?? null,
          "divide_crew_hours",
        ),
      );
    }

    const durationById = new Map(
      bookings.map((b) => [b.id, b.duration_minutes ?? 0]),
    );
    const divideById = new Map(
      (bkRes.data ?? []).map((b) => [
        b.id,
        b.divide_hours_evenly === true ||
          orgDivide.get(b.organization_id) === true,
      ]),
    );

    for (const r of crewRows) {
      const full = durationById.get(r.booking_id) ?? 0;
      if (full <= 0) continue;

      // 1. A split segment always wins — it is the explicit statement of when
      //    this person works and for how long.
      if (r.split_duration_minutes && r.split_duration_minutes > 0) {
        out.set(shiftWindowKey(r.booking_id, r.membership_id), {
          startOffsetMinutes: r.split_start_offset_minutes ?? 0,
          allottedMinutes: r.split_duration_minutes,
        });
        continue;
      }

      // 2/3. Otherwise everyone starts with the booking and shares the length.
      const crew = crewCount.get(r.booking_id) ?? 0;
      const divides = crew >= 2 && divideById.get(r.booking_id) === true;
      out.set(shiftWindowKey(r.booking_id, r.membership_id), {
        startOffsetMinutes: 0,
        allottedMinutes: divides ? Math.max(1, Math.round(full / crew)) : full,
      });
    }
  } catch (err) {
    console.error("[crew-hours] resolveShiftWindows threw:", err);
  }
  return out;
}
