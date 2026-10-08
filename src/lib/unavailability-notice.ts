import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { memberDisplayName } from "@/lib/member-display";
import { notify } from "@/lib/notify";
import {
  buildUnavailabilityNotice,
  type UnavailabilityKind,
} from "@/lib/unavailability";

type AdminDb = ReturnType<typeof createSupabaseAdminClient>;

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Jobs this person is on — as assigned_to OR anywhere on the crew — between
 * two org-local calendar dates, inclusive. Cancelled and completed jobs don't
 * need cover, so they don't count.
 */
async function countBookedJobs(
  db: AdminDb,
  organizationId: string,
  membershipId: string,
  startDate: string,
  endDate: string,
  tz: string,
): Promise<number> {
  const from = localInputToUtcIso(`${startDate}T00:00`, tz);
  const to = localInputToUtcIso(`${nextDay(endDate)}T00:00`, tz);

  const [{ data: asLead }, { data: asCrew }] = await Promise.all([
    db
      .from("bookings")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("assigned_to", membershipId)
      .gte("scheduled_at", from)
      .lt("scheduled_at", to)
      .not("status", "in", '("cancelled","completed")')
      .limit(200) as unknown as Promise<{ data: Array<{ id: string }> | null }>,
    db
      .from("booking_assignees")
      .select("booking:bookings!inner ( id, status, organization_id )")
      .eq("membership_id", membershipId)
      .eq("booking.organization_id", organizationId)
      .gte("booking.scheduled_at", from)
      .lt("booking.scheduled_at", to)
      .limit(200) as unknown as Promise<{
      data: Array<{
        booking: { id: string; status: string } | null;
      }> | null;
    }>,
  ]);

  const ids = new Set((asLead ?? []).map((b) => b.id));
  for (const r of asCrew ?? []) {
    if (r.booking && !["cancelled", "completed"].includes(r.booking.status)) {
      ids.add(r.booking.id);
    }
  }
  return ids.size;
}

/**
 * Tell the office a cleaner said they can't work. Neither a new time-off
 * request nor a day marked unavailable told anyone — the request waited on
 * Timesheets until someone happened to open it, and the day off appeared as
 * grey stripes on the board, unannounced. Best-effort: a failed notice never
 * fails the cleaner's save.
 */
export async function notifyManagersOfUnavailability(input: {
  organizationId: string;
  membershipId: string;
  kind: UnavailabilityKind;
  startDate: string;
  endDate: string;
}): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    const tz = await getOrgTimezone(input.organizationId);
    const [{ data: me }, bookedJobs] = await Promise.all([
      db
        .from("memberships")
        .select("display_name, profile:profiles ( full_name )")
        .eq("id", input.membershipId)
        .maybeSingle() as unknown as Promise<{
        data: {
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      }>,
      countBookedJobs(
        db,
        input.organizationId,
        input.membershipId,
        input.startDate,
        input.endDate,
        tz,
      ),
    ]);

    const { title, body } = buildUnavailabilityNotice({
      kind: input.kind,
      name: me ? memberDisplayName(me) : "A team member",
      startDate: input.startDate,
      endDate: input.endDate,
      bookedJobs,
    });

    await notify({
      audience: "org-management",
      organizationId: input.organizationId,
      excludeMembershipId: input.membershipId,
      title,
      body,
      // A request is approved on Timesheets; a day off is dealt with on the
      // board, opened on that day.
      href:
        input.kind === "time_off_request"
          ? "/app/timesheets"
          : `/app/scheduling?view=day&week=${input.startDate}`,
    });
  } catch (err) {
    console.error("[unavailability] manager notice failed:", err);
  }
}

/**
 * Which of these people are off on this org-local date: approved time off
 * covering it, or the day marked unavailable. The same two sources the
 * board's grey stripes come from.
 */
export async function membersOffOn(
  organizationId: string,
  membershipIds: string[],
  ymd: string,
): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const db = createSupabaseAdminClient();
  const [{ data: pto }, { data: overrides }] = await Promise.all([
    db
      .from("pto_requests")
      .select("employee_id")
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .in("employee_id", membershipIds)
      .lte("start_date", ymd)
      .gte("end_date", ymd) as unknown as Promise<{
      data: Array<{ employee_id: string }> | null;
    }>,
    db
      .from("availability_overrides" as never)
      .select("membership_id")
      .eq("organization_id" as never, organizationId as never)
      .eq("kind" as never, "off" as never)
      .eq("date" as never, ymd as never)
      .in("membership_id" as never, membershipIds as never) as unknown as Promise<{
      data: Array<{ membership_id: string }> | null;
    }>,
  ]);
  return [
    ...new Set([
      ...(pto ?? []).map((r) => r.employee_id),
      ...(overrides ?? []).map((r) => r.membership_id),
    ]),
  ];
}
