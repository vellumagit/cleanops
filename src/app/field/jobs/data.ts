import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgTimezone } from "@/lib/org-timezone";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import type { CurrentMembership } from "@/lib/auth";

export type FieldJob = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  service_type: string;
  address: string | null;
  notes: string | null;
  client: { name: string | null; address: string | null } | null;
  display_address: string | null;
  needs_acceptance: boolean;
  effective_scheduled_at: string;
  effective_duration_minutes: number;
};

/** YYYY-MM-DD for an instant in the org's timezone (for day bucketing). */
export function localDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}

export function isStarted(status: string): boolean {
  return status === "en_route" || status === "in_progress";
}

/**
 * Fetch every upcoming/recent job assigned to this member (via the
 * booking_assignees junction), enriched with segment-adjusted times, a
 * display address (falls back to the client's), and a needs_acceptance
 * flag. Shared by the Today and Shifts field screens.
 */
export async function fetchMyFieldJobs(
  membership: CurrentMembership,
): Promise<{ jobs: FieldJob[]; tz: string }> {
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);

  // From yesterday onwards so an overnight/overdue job doesn't disappear.
  const since = new Date();
  since.setDate(since.getDate() - 1);
  since.setHours(0, 0, 0, 0);

  const assigneeResp = (await supabase
    .from("booking_assignees" as never)
    .select(
      "booking_id, split_start_offset_minutes, split_duration_minutes, acceptance_status",
    )
    .eq("membership_id" as never, membership.id as never)) as unknown as {
    data: Array<{
      booking_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
      acceptance_status: string | null;
    }> | null;
    error: { message: string } | null;
  };
  if (assigneeResp.error) throw assigneeResp.error;

  const assigneeByBooking = new Map(
    (assigneeResp.data ?? []).map((r) => [r.booking_id, r]),
  );
  const bookingIds = Array.from(assigneeByBooking.keys());

  const bookingsResp =
    bookingIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("bookings")
          .select(
            `id, scheduled_at, duration_minutes, status, service_type,
             address, notes, client:clients ( name, address )`,
          )
          .in("id", bookingIds)
          .gte("scheduled_at", since.toISOString())
          .neq("status", "cancelled")
          .order("scheduled_at", { ascending: true })
          .limit(100);
  if (bookingsResp.error) throw bookingsResp.error;

  // For "divide hours evenly" jobs we show each cleaner their share
  // (duration ÷ crew), so we need the full crew size per booking and the
  // flag. Both live outside the generated types / this member's own row, so
  // fetch them separately (cast around the untyped column).
  const [crewRows, flagRows, orgAutoResp] = bookingIds.length
    ? await Promise.all([
        supabase
          .from("booking_assignees" as never)
          .select("booking_id" as never)
          .in("booking_id" as never, bookingIds as never) as unknown as Promise<{
          data: Array<{ booking_id: string }> | null;
        }>,
        supabase
          .from("bookings" as never)
          .select("id, divide_hours_evenly" as never)
          .in("id" as never, bookingIds as never) as unknown as Promise<{
          data: Array<{ id: string; divide_hours_evenly: boolean | null }> | null;
        }>,
        supabase
          .from("organizations")
          .select("automation_settings")
          .eq("id", membership.organization_id)
          .maybeSingle() as unknown as Promise<{
          data: {
            automation_settings: Record<
              string,
              { enabled?: boolean } | undefined
            > | null;
          } | null;
        }>,
      ])
    : [{ data: [] }, { data: [] }, { data: null }];
  // Org-level default: when on, EVERY team job divides hours automatically.
  const orgDivide = resolveAutomationEnabled(
    orgAutoResp?.data?.automation_settings ?? null,
    "divide_crew_hours",
  );
  const crewCountByBooking = new Map<string, number>();
  for (const r of crewRows.data ?? []) {
    crewCountByBooking.set(
      r.booking_id,
      (crewCountByBooking.get(r.booking_id) ?? 0) + 1,
    );
  }
  const divideByBooking = new Map(
    (flagRows.data ?? []).map((r) => [r.id, r.divide_hours_evenly === true]),
  );

  const jobs: FieldJob[] = (bookingsResp.data ?? []).map((b) => {
    const seg = assigneeByBooking.get(b.id);
    const offset = seg?.split_start_offset_minutes ?? null;
    const segDur = seg?.split_duration_minutes ?? null;
    // Share the total evenly when the owner flagged it and this cleaner isn't
    // on a hand-off split segment.
    const crewCount = crewCountByBooking.get(b.id) ?? 1;
    const sharesEvenly =
      (orgDivide || divideByBooking.get(b.id) === true) &&
      segDur == null &&
      crewCount >= 2;
    return {
      ...b,
      display_address: b.address ?? b.client?.address ?? null,
      needs_acceptance:
        seg?.acceptance_status === "pending" && b.status !== "completed",
      effective_scheduled_at:
        offset != null
          ? new Date(
              new Date(b.scheduled_at).getTime() + offset * 60_000,
            ).toISOString()
          : b.scheduled_at,
      effective_duration_minutes: sharesEvenly
        ? Math.round(b.duration_minutes / crewCount)
        : segDur ?? b.duration_minutes,
    };
  });
  jobs.sort(
    (a, b) =>
      new Date(a.effective_scheduled_at).getTime() -
      new Date(b.effective_scheduled_at).getTime(),
  );

  return { jobs, tz };
}
