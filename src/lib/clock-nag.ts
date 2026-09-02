import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership } from "@/lib/push";

/**
 * Take back the "Still on the clock?" nudge once someone has clocked out.
 *
 * The nudge is deliberately STICKY — it behaves like an ongoing-shift
 * indicator, staying in the phone's notification shade until dismissed, and
 * rewriting itself every 30 minutes with the running total. That is right
 * while the shift is running and wrong the instant it ends, because nothing
 * ever took it back.
 *
 * Olha, 2026-09-02: clocked in at 8:58, nudged at 15:01 ("You've been clocked
 * in for 6.0h — tap to clock out"), clocked out successfully at 15:05. The
 * shift closed cleanly, and her phone went on saying "tap to clock out". She
 * tapped it repeatedly; each tap opened a clock page that agreed she was not
 * clocked in, and the notification stayed. From where she stood the app was
 * refusing to let her clock out.
 *
 * So the same event that closes the shift retracts the nudge: the push is
 * dismissed by tag, and the in-app row is marked read so the bell agrees.
 * Best-effort throughout — a failure here must never fail a clock-out.
 */
export async function clearClockOutNag(opts: {
  membershipId: string;
  /** The time entry that just closed — its id is the push tag. */
  entryId: string;
}): Promise<void> {
  const { membershipId, entryId } = opts;
  try {
    // Retract the sticky push. Same tag the nag was sent under
    // (src/lib/automations.ts), so the service worker can find and close it.
    await sendPushToMembership(membershipId, {
      title: "",
      dismiss: true,
      tag: `clock-out-${entryId}`,
    });
  } catch (err) {
    console.error("[clock-nag] push retraction failed:", err);
  }

  try {
    // And the in-app copy, so the notification list doesn't keep asking
    // either. Unread ones only — a read row is already history.
    const admin = createSupabaseAdminClient();
    await admin
      .from("notifications" as never)
      .update({ read_at: new Date().toISOString() } as never)
      .eq("recipient_membership_id" as never, membershipId as never)
      .eq("type" as never, "clock_out_reminder" as never)
      .is("read_at" as never, null as never);
  } catch (err) {
    console.error("[clock-nag] mark-read failed:", err);
  }
}
