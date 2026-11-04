import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Record that a crew member's part of a job is over, when it was ended for
 * her rather than by her own "I'm done": the office closing her shift, or
 * her starting her next job (which closes the open one).
 *
 * Since 2026-11-03 a stopped clock without this mark is a break — "Stop my
 * clock", the job stays open until the window ends (job-state.ts). These
 * other endings are not breaks. Without the mark, a job whose last shift
 * the office closed at 4:20 would sit open until its window ended instead
 * of closing at 4:20 (Oliver Little, 2026-10-28).
 *
 * Only fills an empty mark; clocking back in clears it again
 * (startJobAction). Best-effort: a failure here must not undo the clock-out.
 */
export async function markPartDone(
  bookingId: string,
  membershipId: string,
  atIso: string,
): Promise<void> {
  try {
    await (createSupabaseAdminClient()
      .from("booking_assignees")
      .update({ completed_at: atIso } as never)
      .eq("booking_id", bookingId)
      .eq("membership_id", membershipId)
      .is("completed_at", null) as unknown as Promise<unknown>);
  } catch (err) {
    console.error("[part-done] mark failed:", bookingId, membershipId, err);
  }
}
