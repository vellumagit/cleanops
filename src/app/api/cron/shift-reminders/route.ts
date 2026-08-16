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

import { runJobWatch, sendShiftClockOutReminders } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendShiftClockOutReminders();
    // An open shift in a disabled org is an UNPROTECTED shift — nothing will
    // nudge the cleaner and nothing will cap it. The run used to report only
    // what it acted on, so a org with the toggle off looked identical to a
    // quiet one, and the gap surfaced as a complaint instead of a number.
    if (result.skippedDisabled > 0) {
      console.warn(
        `[cron/shift-reminders] ${result.skippedDisabled} open shift(s) unprotected — ` +
          `shift_clock_out_reminder is off for org(s): ${result.orgsDisabled.join(", ")}`,
      );
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

    return Response.json({ ...result, watch });
  } catch (err) {
    console.error("[cron/shift-reminders] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
