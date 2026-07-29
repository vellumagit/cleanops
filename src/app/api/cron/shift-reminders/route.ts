/**
 * Cron: forgotten clock-out reminders — every 30 minutes.
 *
 * Nudges an employee who is still on the clock past their job's expected end,
 * repeats every 30 minutes, and at +2h caps the shift, flags it for review,
 * notifies management, and SMSes the owner.
 *
 * Frequent by necessity: a shift that has run 30 minutes long is a nudge, one
 * that has run three days is a payroll problem, and only a short interval
 * catches it while it is still the former.
 *
 * Gated by the per-org `shift_clock_out_reminder` automation toggle and the
 * org master switch. Protected by CRON_SECRET.
 */

import { sendShiftClockOutReminders } from "@/lib/automations";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await sendShiftClockOutReminders();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/shift-reminders] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
