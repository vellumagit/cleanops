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
  /** Money still owed that NOTHING will pay automatically once they're off
   *  the roster: pending bonuses are skipped by every future payroll run
   *  (which only prices non-roster people's raw hours), and approved
   *  future time off is neither worked nor paid. Surfaced, not resolved —
   *  paying or voiding them is the owner's call. */
  pendingBonusCents: number;
  pendingBonusCount: number;
  approvedFuturePtoCount: number;
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
    pendingBonusCents: 0,
    pendingBonusCount: 0,
    approvedFuturePtoCount: 0,
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

  // ── 4. Money that would otherwise vanish ─────────────────────────────
  // Read-only: pending bonuses are EXPLICITLY skipped for people off the
  // active roster by payroll-run-create (its hoursOnly bucket prices raw
  // hours, nothing else), and approved future PTO is neither cancelled by
  // step 3 (pending-only) nor ever paid. Left alone, both debts are
  // invisible on every screen. The decision — pay it out or void it —
  // belongs to the owner, so this step counts and reports, never writes.
  try {
    const todayYmd = nowIso.slice(0, 10);
    const [{ data: bonuses }, { count: futurePto }] = await Promise.all([
      // payroll_run_id NULL on both: a prepared-but-unpaid run stamps the
      // rows it consumed while their status stays pending/approved — those
      // WILL be paid, and counting them here would tell the owner to pay
      // them a second time.
      admin
        .from("bonuses")
        .select("amount_cents")
        .eq("organization_id", organizationId)
        .eq("employee_id", membershipId)
        .eq("status", "pending")
        .is("payroll_run_id", null) as unknown as Promise<{
        data: Array<{ amount_cents: number }> | null;
      }>,
      admin
        .from("pto_requests")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("employee_id", membershipId)
        .eq("status", "approved")
        .is("payroll_run_id" as never, null as never)
        .gte("end_date", todayYmd) as unknown as Promise<{
        count: number | null;
      }>,
    ]);
    result.pendingBonusCount = bonuses?.length ?? 0;
    result.pendingBonusCents = (bonuses ?? []).reduce(
      (s, b) => s + b.amount_cents,
      0,
    );
    result.approvedFuturePtoCount = futurePto ?? 0;
  } catch (err) {
    console.error("[offboard] owed-money check failed:", err);
  }

  // ── 5. Tell whoever has to act on it ─────────────────────────────────
  // Only when there's something to act on — a clean offboard stays quiet.
  if (
    result.unassignedBookings.length > 0 ||
    result.closedEntryId ||
    result.pendingBonusCount > 0 ||
    result.approvedFuturePtoCount > 0
  ) {
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
      if (result.pendingBonusCount > 0) {
        const dollars = (result.pendingBonusCents / 100).toFixed(2);
        lines.push(
          `They have ${result.pendingBonusCount} pending bonus${
            result.pendingBonusCount === 1 ? "" : "es"
          } totalling $${dollars} that no future payroll run will pick up — pay or delete ${
            result.pendingBonusCount === 1 ? "it" : "them"
          } on Bonuses.`,
        );
      }
      if (result.approvedFuturePtoCount > 0) {
        lines.push(
          `${result.approvedFuturePtoCount} approved time-off request${
            result.approvedFuturePtoCount === 1 ? "" : "s"
          } reaching into the future ${
            result.approvedFuturePtoCount === 1 ? "is" : "are"
          } still on the books — decide whether ${
            result.approvedFuturePtoCount === 1 ? "it" : "they"
          } should be paid out.`,
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
            : result.closedEntryId
              ? "/app/timesheets"
              : result.pendingBonusCount > 0
                ? "/app/bonuses"
                : "/app/timesheets",
      });
    } catch (err) {
      console.error("[offboard] notify failed:", err);
    }
  }

  return result;
}
