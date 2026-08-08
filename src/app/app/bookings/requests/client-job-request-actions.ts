"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  if (accept && req.booking_id) {
    // Cancel rather than delete, same as the auto-applied path: a client
    // skipping one week has not ended their standing series, and deleting the
    // row would take the request's own record with it.
    const { error } = await admin
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", req.booking_id)
      .eq("organization_id", membership.organization_id);
    if (error) return { error: error.message };
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
  if (accept && req.booking_id) {
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
