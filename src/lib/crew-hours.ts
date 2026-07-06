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
