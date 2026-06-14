import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgTimezone } from "@/lib/org-timezone";
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

  const jobs: FieldJob[] = (bookingsResp.data ?? []).map((b) => {
    const seg = assigneeByBooking.get(b.id);
    const offset = seg?.split_start_offset_minutes ?? null;
    const segDur = seg?.split_duration_minutes ?? null;
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
      effective_duration_minutes: segDur ?? b.duration_minutes,
    };
  });
  jobs.sort(
    (a, b) =>
      new Date(a.effective_scheduled_at).getTime() -
      new Date(b.effective_scheduled_at).getTime(),
  );

  return { jobs, tz };
}
