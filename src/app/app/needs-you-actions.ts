"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { closeJob } from "@/lib/close-job";
import { syncJob } from "@/lib/job-sync";
import { deleteMemberCalendarEvent } from "@/lib/google-calendar";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The one-tap answers on the dashboard's "Needs you" list. Each is a
 * decision only a person can make, done in one place so the list and the
 * job page agree on what it did.
 */

function managerOnly(role: string): Result | null {
  return ["owner", "admin", "manager"].includes(role)
    ? null
    : { ok: false, error: "Only owners, admins, or managers can do that." };
}

function done(): Result {
  revalidatePath("/app");
  revalidatePath("/app/bookings");
  revalidatePath("/app/timesheets");
  return { ok: true };
}

/** "Close it": the job is over, whoever is still rostered. */
export async function closeJobAction(bookingId: string): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  const r = await closeJob({ membership, supabase, bookingId });
  if (!r.ok) return r;
  revalidatePath(`/app/bookings/${bookingId}`);
  return done();
}

/** "Still coming" / "Still working" / "Give it an hour": ask again later. */
export async function snoozeItemAction(key: string, untilIso: string): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  const denied = managerOnly(membership.role);
  if (denied) return denied;
  const until = new Date(untilIso).getTime();
  if (!Number.isFinite(until) || !key) return { ok: false, error: "Bad snooze." };
  const { error } = await (supabase
    .from("needs_you_state" as never)
    .upsert(
      {
        organization_id: membership.organization_id,
        key,
        snoozed_until: new Date(until).toISOString(),
        snoozed_by: membership.id,
      } as never,
      { onConflict: "organization_id,key" } as never,
    ) as unknown as Promise<{ error: { message: string } | null }>);
  if (error) return { ok: false, error: error.message };
  return done();
}

/** "Remove from job": she isn't coming; take her off this visit. */
export async function removeMemberAction(
  bookingId: string,
  membershipId: string,
): Promise<Result> {
  const { membership } = await getActionContext();
  const denied = managerOnly(membership.role);
  if (denied) return denied;
  const admin = createSupabaseAdminClient();

  const { data: booking } = (await admin
    .from("bookings")
    .select("id, assigned_to")
    .eq("id", bookingId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { id: string; assigned_to: string | null } | null };
  if (!booking) return { ok: false, error: "Job not found." };

  const { error } = await admin
    .from("booking_assignees")
    .delete()
    .eq("booking_id", bookingId)
    .eq("membership_id", membershipId)
    .eq("organization_id", membership.organization_id);
  if (error) return { ok: false, error: error.message };

  // Same promotion rule as a cleaner dropping her own shift: a job that
  // still has crew must not read as unfilled.
  if (booking.assigned_to === membershipId) {
    const { data: remaining } = (await admin
      .from("booking_assignees")
      .select("membership_id")
      .eq("booking_id", bookingId)
      .order("split_index", { ascending: true, nullsFirst: true })
      .limit(1)) as unknown as { data: Array<{ membership_id: string }> | null };
    const next = remaining?.[0]?.membership_id ?? null;
    await admin.from("bookings").update({ assigned_to: next }).eq("id", bookingId);
    if (next) {
      await admin
        .from("booking_assignees")
        .update({ is_primary: true })
        .eq("booking_id", bookingId)
        .eq("membership_id", next);
    }
  }

  deleteMemberCalendarEvent(membershipId, bookingId).catch(() => {});
  await logAuditEvent({
    membership,
    action: "assign",
    entity: "booking",
    entity_id: bookingId,
    after: { removed_membership_id: membershipId, via: "needs_you" },
  });
  await syncJob(bookingId, "crew_changed");
  revalidatePath(`/app/bookings/${bookingId}`);
  return done();
}

/** "Clock out at 3:00 AM": end a shift that ran past its hours, at its hours. */
export async function clockOutAtAction(
  entryId: string,
  bookingId: string,
  atIso: string,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  const denied = managerOnly(membership.role);
  if (denied) return denied;
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(at)) return { ok: false, error: "Bad time." };

  const { data: entry } = await supabase
    .from("time_entries")
    .select("id, clock_in_at, clock_out_at, employee_id, booking_id")
    .eq("id", entryId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Shift not found." };
  // The job to recompute is the shift's own, never the id the client sent:
  // syncJob runs on the admin client with no org filter.
  if (bookingId !== entry.booking_id) {
    return { ok: false, error: "That shift isn't on this job." };
  }
  if (entry.clock_out_at) return { ok: true };
  if (at <= new Date(entry.clock_in_at).getTime()) {
    return { ok: false, error: "That's before she clocked in." };
  }

  const { error } = await supabase
    .from("time_entries")
    .update({ clock_out_at: new Date(at).toISOString(), needs_review: true } as never)
    .eq("id", entryId)
    .is("clock_out_at", null);
  if (error) return { ok: false, error: error.message };

  const { clearClockOutNag } = await import("@/lib/clock-nag");
  await clearClockOutNag({ membershipId: entry.employee_id, entryId });
  await logAuditEvent({
    membership,
    action: "update",
    entity: "time_entry",
    entity_id: entryId,
    before: { clock_out_at: null },
    after: { clock_out_at: new Date(at).toISOString(), via: "needs_you" },
  });
  await syncJob(bookingId, "shift_closed_by_manager");
  return done();
}
