/**
 * Cron: shift watch — every 30 minutes. Both ends of the shift.
 *
 * Clock-OUT (sendShiftClockOutReminders): nudges an employee who is still on
 * the clock past their job's expected end, repeats every 30 minutes, and at
 * +2h caps the shift, flags it for review, notifies management, and SMSes the
 * owner.
 *
 * Clock-IN (runJobWatch): nudges the crew when a job's start time passes with
 * nobody clocked in, and asks the office about a job whose whole window passed
 * in silence — before auto-complete turns it into an invoice.
 *
 * Frequent by necessity: a shift that has run 30 minutes long is a nudge, one
 * that has run three days is a payroll problem, and only a short interval
 * catches it while it is still the former.
 *
 * Gated by the per-org `shift_clock_out_reminder` automation toggle and the
 * org master switch. Protected by CRON_SECRET.
 */

import {
  runJobWatch,
  sendShiftClockOutReminders,
  chaseUnconfirmedShifts,
} from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendNeedsYouAlerts } from "@/lib/needs-you-alerts";
import { syncLiveJobs } from "@/lib/job-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    // First leg, caught like the other three: a throw here used to go to the
    // outer catch and return 500 before job watch, the confirm chase and the
    // Needs-you alerts had run — one bad org row silenced every org's alerts
    // and the 6 PM digest for as long as it kept throwing.
    let result:
      | Awaited<ReturnType<typeof sendShiftClockOutReminders>>
      | { error: string };
    try {
      result = await sendShiftClockOutReminders();
      // An open shift in a disabled org is an UNPROTECTED shift — nothing
      // will nudge the cleaner and nothing will cap it. The run used to
      // report only what it acted on, so an org with the toggle off looked
      // identical to a quiet one, and the gap surfaced as a complaint
      // instead of a number.
      if (result.skippedDisabled > 0) {
        console.warn(
          `[cron/shift-reminders] ${result.skippedDisabled} open shift(s) unprotected — ` +
            `shift_clock_out_reminder is off for org(s): ${result.orgsDisabled.join(", ")}`,
        );
      }
    } catch (capErr) {
      console.error("[cron/shift-reminders] clock-out leg error:", capErr);
      result = { error: capErr instanceof Error ? capErr.message : "Unknown error" };
    }

    // Both ends of the same shift, on the same 30-minute heartbeat: the call
    // above watches shifts that never STOPPED, this one watches jobs that
    // never STARTED. Separate toggles, and a failure in one must not silence
    // the other, so this is caught independently.
    let watch: Awaited<ReturnType<typeof runJobWatch>> | { error: string };
    try {
      watch = await runJobWatch();
      if (watch.orgsWithoutClockIn.length > 0) {
        console.log(
          `[cron/shift-reminders] job watch skipped ${watch.orgsWithoutClockIn.length} org(s) with no recent clock-in activity`,
        );
      }
    } catch (watchErr) {
      console.error("[cron/shift-reminders] job watch error:", watchErr);
      watch = {
        error: watchErr instanceof Error ? watchErr.message : "Unknown error",
      };
    }

    // Third leg of the same heartbeat: shifts nobody has said yes to yet.
    let confirm: Awaited<ReturnType<typeof chaseUnconfirmedShifts>> | { error: string };
    try {
      confirm = await chaseUnconfirmedShifts();
    } catch (confirmErr) {
      console.error("[cron/shift-reminders] confirm chase error:", confirmErr);
      confirm = {
        error: confirmErr instanceof Error ? confirmErr.message : "Unknown error",
      };
    }
    // Fourth leg: the "Needs you" list, pushed to managers the first time an
    // item appears, and the 6 PM night-before check.
    let needsYou: Awaited<ReturnType<typeof sendNeedsYouAlerts>> | { error: string };
    try {
      needsYou = await sendNeedsYouAlerts();
    } catch (nyErr) {
      console.error("[cron/shift-reminders] needs-you error:", nyErr);
      needsYou = { error: nyErr instanceof Error ? nyErr.message : "Unknown error" };
    }
    // Fifth leg: recompute every live job, so a window ending or an
    // auto-complete grace running out takes effect without waiting for a
    // tap or the 2 AM sweep. Before the Needs-you leg would be wrong: the
    // list should ask about a no-show while the question is still open.
    let heartbeat: Awaited<ReturnType<typeof syncLiveJobs>> | { error: string };
    try {
      heartbeat = await syncLiveJobs();
    } catch (hbErr) {
      console.error("[cron/shift-reminders] job-state heartbeat error:", hbErr);
      heartbeat = { error: hbErr instanceof Error ? hbErr.message : "Unknown error" };
    }
    return Response.json({ ...result, watch, confirm, needsYou, heartbeat });
  } catch (err) {
    console.error("[cron/shift-reminders] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
