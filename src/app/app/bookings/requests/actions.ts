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
      responded_at: nextStatus === "pending" ? null : new Date().toISOString(),
      responded_by: nextStatus === "pending" ? null : membership.id,
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never);

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

  // Declining used to be silent: the portal flipped the chip to
  // "declined" and the client heard nothing — the exact phone call the
  // portal exists to prevent. A short note closes the loop. Scheduling
  // needs nothing here: the booking-confirmation flow already writes.
  if (nextStatus === "declined") {
    try {
      const { data: req } = (await admin
        .from("booking_requests" as never)
        .select(
          "service_type, client:clients ( name, email )" as never,
        )
        .eq("id" as never, id as never)
        .maybeSingle()) as unknown as {
        data: {
          service_type: string | null;
          client: { name: string | null; email: string | null } | null;
        } | null;
      };
      if (req?.client?.email) {
        const { sendOrgEmail } = await import("@/lib/email");
        const { getOrgName } = await import("@/lib/org-name");
        const orgName = await getOrgName(membership.organization_id);
        await sendOrgEmail(membership.organization_id, {
          to: req.client.email,
          toName: req.client.name ?? undefined,
          subject: `About your booking request — ${orgName}`,
          text: `Hi ${req.client.name ?? "there"},\n\nWe can't take on your recent request${req.service_type ? ` (${req.service_type})` : ""} as submitted. If the timing was the issue, send another request with different dates — or just reply to this email and we'll figure it out together.\n\n— ${orgName}`,
          html: `<p>Hi ${req.client.name ?? "there"},</p><p>We can&rsquo;t take on your recent request${req.service_type ? ` (<strong>${req.service_type}</strong>)` : ""} as submitted. If the timing was the issue, send another request with different dates — or just reply to this email and we&rsquo;ll figure it out together.</p><p>— ${orgName}</p>`,
        });
      }
    } catch (err) {
      console.error("[booking-request] decline notice failed:", err);
    }
  }

  revalidatePath("/app/bookings/requests");
}
