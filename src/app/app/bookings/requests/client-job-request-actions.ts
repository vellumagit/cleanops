"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cancelJobs } from "@/lib/cancel-jobs";

export type ResolveState = { ok?: boolean; error?: string };

/**
 * Answer a client's skip request that was too close in to auto-apply.
 *
 * `accept` cancels the visit; declining leaves it standing. Either way the row
 * is marked resolved so it leaves the queue — an unanswered request sitting
 * there forever is how a client ends up phoning anyway, which is the thing the
 * portal exists to prevent.
 *
 * Writes through the admin client after getActionContext() has proven the role,
 * because the managers-update RLS policy covers client_job_requests but not the
 * bookings cancel that goes with it, and both should succeed or neither.
 */
export async function resolveClientSkipAction(
  _prev: ResolveState,
  formData: FormData,
): Promise<ResolveState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Not authorized." };
  }

  const requestId = String(formData.get("request_id") ?? "").trim();
  const accept = String(formData.get("accept") ?? "") === "1";
  if (!requestId) return { error: "Missing request." };

  const admin = createSupabaseAdminClient();
  const { data: req } = (await admin
    .from("client_job_requests" as never)
    .select("id, booking_id, organization_id, status, kind")
    .eq("id", requestId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      booking_id: string | null;
      organization_id: string;
      status: string;
      kind: string;
    } | null;
  };
  if (!req) return { error: "Request not found." };
  if (req.status === "resolved") return { ok: true };

  // Whether this approval is what took the visit off the schedule. A visit
  // already cancelled, finished or under way is left as it is, and the crew
  // is not told about a cancellation that did not happen.
  let cancelledNow = false;
  if (accept && req.booking_id) {
    // Cancel rather than delete, same as the auto-applied path: a client
    // skipping one week has not ended their standing series, and deleting the
    // row would take the request's own record with it.
    // Own wording for the crew below, so no standard notices.
    const res = await cancelJobs({
      organizationId: membership.organization_id,
      bookingIds: [req.booking_id],
      fromStatuses: ["pending", "confirmed"],
      via: "client_skip_approved",
      syncReason: "client_skip",
      actorId: membership.id,
      calendars: "all",
      notices: "none",
      defer: true,
    });
    if (res.error) return { error: res.error };
    cancelledNow = res.cancelled.length > 0;
    if (!cancelledNow) {
      // Nothing was cancelled. If the visit is already off the schedule the
      // request is simply answered. If it is under way or finished, say so
      // and leave the request open: approving would otherwise read as
      // "cancelled" over a job that happened (and, before this went through
      // the one cancel path, it DID cancel a finished, even invoiced, job).
      const { data: current } = (await admin
        .from("bookings")
        .select("status")
        .eq("id", req.booking_id)
        .eq("organization_id", membership.organization_id)
        .maybeSingle()) as unknown as { data: { status: string } | null };
      if (current && current.status !== "cancelled") {
        return {
          error:
            current.status === "completed"
              ? "This visit is already finished, so it wasn't cancelled. Decline the request, or change the job from its own page."
              : "This visit is already under way, so it wasn't cancelled. Decline the request, or change the job from its own page.",
        };
      }
    }
  }

  const { error: reqErr } = (await admin
    .from("client_job_requests" as never)
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: membership.id,
    } as never)
    .eq("id", requestId)) as unknown as {
    error: { message: string } | null;
  };
  if (reqErr) return { error: reqErr.message };

  // Tell the crew only when the visit actually came off the schedule.
  if (accept && req.booking_id && cancelledNow) {
    const bookingId = req.booking_id;
    const orgId = req.organization_id;
    after(async () => {
      const { notify } = await import("@/lib/notify");
      const { data: crew } = (await admin
        .from("booking_assignees")
        .select("membership_id")
        .eq("booking_id", bookingId)) as unknown as {
        data: Array<{ membership_id: string }> | null;
      };
      for (const c of crew ?? []) {
        await notify({
          organizationId: orgId,
          audience: "membership",
          membershipId: c.membership_id,
          type: "client_request",
          title: "A job was cancelled",
          body: "The client asked to skip this visit and the office approved it.",
          href: "/field/shifts",
        });
      }
    });
  }

  revalidatePath("/app/bookings/requests");
  if (req.booking_id) revalidatePath(`/app/bookings/${req.booking_id}`);
  revalidatePath("/app/bookings");
  return { ok: true };
}
