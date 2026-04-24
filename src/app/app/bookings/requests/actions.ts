"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

/**
 * Mark a booking request as responded. Owner used either "scheduled"
 * (they created a real booking for it) or "declined" (not doing it).
 * Either way the request moves out of the pending inbox.
 *
 * Admin client is used for the UPDATE because the booking_requests
 * table has no UPDATE RLS policy by design — writes go through
 * authorized server actions only.
 *
 * Returns void so this can be wired to a plain <form action={...}>.
 * Failures are logged server-side; successful updates revalidate the
 * list page so the row moves to the resolved tab.
 */
export async function updateRequestStatusAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const nextStatus = String(formData.get("status") ?? "");

  if (!id) return;
  if (!["scheduled", "declined", "pending"].includes(nextStatus)) return;

  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("booking_requests" as never)
    .update({
      status: nextStatus,
      responded_at:
        nextStatus === "pending" ? null : new Date().toISOString(),
      responded_by: nextStatus === "pending" ? null : membership.id,
    } as never)
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    );

  if (error) {
    console.error("[booking-request] status update failed:", error.message);
    return;
  }

  await logAuditEvent({
    membership,
    action: nextStatus === "pending" ? "update" : "status_change",
    entity: "booking_request",
    entity_id: id,
    after: { status: nextStatus },
  });

  revalidatePath("/app/bookings/requests");
}
