import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentMembership } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { futureStatusError } from "@/lib/booking-status";

/**
 * A manager declaring a job over. The one human override of the computed
 * job state (src/lib/job-state.ts): the rules can't reach "done" while a
 * rostered person hasn't clocked in and the window is still open, and
 * that's exactly when a person has to say so.
 *
 * Shared by the job page's Mark complete and the dashboard's "Close it".
 */
export async function closeJob(opts: {
  membership: CurrentMembership;
  supabase: SupabaseClient;
  bookingId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { membership, supabase, bookingId } = opts;
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Only owners, admins, or managers can close a job." };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("scheduled_at, status")
    .eq("id", bookingId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Job not found." };
  if (booking.status === "completed") return { ok: true };
  if (booking.status === "cancelled") {
    return { ok: false, error: "This job was cancelled." };
  }
  // Closing drafts an invoice. A pending job was never confirmed, and a job
  // days out hasn't happened: neither should be billed by one click.
  if (booking.status === "pending") {
    return { ok: false, error: "Confirm this job before closing it." };
  }
  const tooEarly = futureStatusError(booking.scheduled_at, "completed");
  if (tooEarly) return { ok: false, error: tooEarly };

  const { error } = await supabase
    .from("bookings")
    .update({
      status: "completed",
      closed_at: new Date().toISOString(),
      closed_by: membership.id,
    } as never)
    .eq("id", bookingId)
    .eq("organization_id", membership.organization_id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "booking",
    entity_id: bookingId,
    before: { status: booking.status },
    after: { status: "completed", via: "close_job" },
  });

  const { autoInvoiceOnJobComplete } = await import("@/lib/automations");
  await autoInvoiceOnJobComplete(bookingId);
  const { syncJob } = await import("@/lib/job-sync");
  await syncJob(bookingId, "manager_close");
  return { ok: true };
}
