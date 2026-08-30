import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgTimezone } from "@/lib/org-timezone";
import { notify } from "@/lib/notify";

/**
 * Everything that must NOT stay attached to a person the moment they stop
 * working here. Deactivation used to flip memberships.status and walk away:
 *
 *  - their FUTURE bookings kept them as the assigned cleaner — nobody was
 *    told the job lost its cover (and until the coverage fix, they even
 *    counted as staffing, silencing the unassigned alert);
 *  - an OPEN time entry kept running forever, accruing into payroll
 *    surfaces;
 *  - their PENDING time-off requests sat in the approval queue.
 *
 * One sweep, callable from single deactivation today and any bulk offboard
 * later. Best-effort per step: a failure in one category is logged and the
 * others still run — deactivating a person must never half-fail silently.
 */

export type OffboardSweepResult = {
  /** Future non-terminal bookings they were removed from. */
  unassignedBookings: Array<{
    id: string;
    scheduled_at: string;
    client_name: string | null;
  }>;
  /** The open time entry that was closed for review, if one existed. */
  closedEntryId: string | null;
  /** Pending PTO requests flipped to cancelled. */
  cancelledPtoIds: string[];
};

const OPEN_STATUSES = ["pending", "confirmed", "en_route"] as const;

export async function sweepDeactivatedMember(
  admin: SupabaseClient,
  opts: {
    organizationId: string;
    membershipId: string;
    /** For the notification body — memberDisplayName output. */
    memberName: string;
  },
): Promise<OffboardSweepResult> {
  const { organizationId, membershipId, memberName } = opts;
  const nowIso = new Date().toISOString();
  const result: OffboardSweepResult = {
    unassignedBookings: [],
    closedEntryId: null,
    cancelledPtoIds: [],
  };

  // ── 1. Future bookings they were covering ────────────────────────────
  try {
    const [{ data: primaries }, { data: crewRows }] = await Promise.all([
      admin
        .from("bookings")
        .select("id, scheduled_at, client:clients ( name )")
        .eq("organization_id", organizationId)
        .eq("assigned_to", membershipId)
        .gte("scheduled_at", nowIso)
        .in("status", OPEN_STATUSES as unknown as string[]) as unknown as
        Promise<{
          data: Array<{
            id: string;
            scheduled_at: string;
            client: { name: string | null } | null;
          }> | null;
        }>,
      admin
        .from("booking_assignees")
        .select(
          "booking_id, booking:bookings ( id, scheduled_at, status, client:clients ( name ) )",
        )
        .eq("organization_id", organizationId)
        .eq("membership_id", membershipId) as unknown as Promise<{
        data: Array<{
          booking_id: string;
          booking: {
            id: string;
            scheduled_at: string;
            status: string;
            client: { name: string | null } | null;
          } | null;
        }> | null;
      }>,
    ]);

    const byId = new Map<
      string,
      { id: string; scheduled_at: string; client_name: string | null }
    >();
    for (const b of primaries ?? []) {
      byId.set(b.id, {
        id: b.id,
        scheduled_at: b.scheduled_at,
        client_name: b.client?.name ?? null,
      });
    }
    const crewBookingIds: string[] = [];
    for (const r of crewRows ?? []) {
      const b = r.booking;
      if (!b) continue;
      if (b.scheduled_at < nowIso) continue;
      if (!(OPEN_STATUSES as readonly string[]).includes(b.status)) continue;
      crewBookingIds.push(r.booking_id);
      if (!byId.has(b.id)) {
        byId.set(b.id, {
          id: b.id,
          scheduled_at: b.scheduled_at,
          client_name: b.client?.name ?? null,
        });
      }
    }

    const primaryIds = (primaries ?? []).map((b) => b.id);
    if (primaryIds.length > 0) {
      await admin
        .from("bookings")
        .update({ assigned_to: null })
        .eq("organization_id", organizationId)
        .in("id", primaryIds);
    }
    if (crewBookingIds.length > 0) {
      await admin
        .from("booking_assignees")
        .delete()
        .eq("organization_id", organizationId)
        .eq("membership_id", membershipId)
        .in("booking_id", crewBookingIds);
    }
    result.unassignedBookings = [...byId.values()].sort((a, b) =>
      a.scheduled_at < b.scheduled_at ? -1 : 1,
    );
  } catch (err) {
    console.error("[offboard] booking unassign failed:", err);
  }

  // ── 2. The open clock, if any ────────────────────────────────────────
  try {
    const { data: closed } = (await admin
      .from("time_entries")
      .update({
        clock_out_at: nowIso,
        // Flagged, not blessed: the end time is the system's, so a human
        // confirms the real hours before payroll pays them — same contract
        // as the forgotten-clock-out capper.
        needs_review: true,
        auto_closed_at: nowIso,
      } as never)
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .is("clock_out_at", null)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    result.closedEntryId = closed?.[0]?.id ?? null;
  } catch (err) {
    console.error("[offboard] open-entry close failed:", err);
  }

  // ── 3. Pending time off ──────────────────────────────────────────────
  try {
    const { data: cancelled } = (await admin
      .from("pto_requests")
      .update({ status: "cancelled" } as never)
      .eq("organization_id", organizationId)
      .eq("employee_id", membershipId)
      .eq("status", "pending")
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    result.cancelledPtoIds = (cancelled ?? []).map((r) => r.id);
  } catch (err) {
    console.error("[offboard] pto cancel failed:", err);
  }

  // ── 4. Tell whoever has to act on it ─────────────────────────────────
  // Only when there's something to act on — a clean offboard stays quiet.
  if (result.unassignedBookings.length > 0 || result.closedEntryId) {
    try {
      const tz = await getOrgTimezone(organizationId);
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const lines: string[] = [];
      if (result.unassignedBookings.length > 0) {
        const shown = result.unassignedBookings
          .slice(0, 4)
          .map(
            (b) =>
              `${b.client_name ?? "a client"} on ${fmt.format(new Date(b.scheduled_at))}`,
          )
          .join("; ");
        lines.push(
          `${result.unassignedBookings.length} upcoming job${
            result.unassignedBookings.length === 1 ? "" : "s"
          } lost their cleaner — ${shown}${
            result.unassignedBookings.length > 4
              ? ` and ${result.unassignedBookings.length - 4} more`
              : ""
          }. Reassign them.`,
        );
      }
      if (result.closedEntryId) {
        lines.push(
          "They were still on the clock — the shift was closed and flagged for review on Timesheets.",
        );
      }
      await notify({
        organizationId,
        audience: "org-management",
        title: `${memberName} was deactivated`,
        body: lines.join(" "),
        href:
          result.unassignedBookings.length > 0
            ? "/app/bookings"
            : "/app/timesheets",
      });
    } catch (err) {
      console.error("[offboard] notify failed:", err);
    }
  }

  return result;
}
