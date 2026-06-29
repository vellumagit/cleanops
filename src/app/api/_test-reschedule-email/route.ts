import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { bookingRescheduledEmail } from "@/lib/email-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEMPORARY diagnostic route — verifies the booking-time timezone fix by
// sending a real "rescheduled" email through the production Resend path. Guarded
// by a one-off secret. DELETE this file right after the test send.
const SECRET = "tz-check-9f3a2c7e1b8d4056";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("key") !== SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const to = url.searchParams.get("to") ?? "musilek.brian@gmail.com";
  const tz = "America/Edmonton";

  // A booking at NOON Edmonton today is 18:00 UTC. Before the fix this printed
  // as "6:00 PM"; with timeZone applied it must read "12:00 PM".
  const newIso = "2026-06-29T18:00:00.000Z"; // 12:00 PM Edmonton
  const oldIso = "2026-06-29T15:00:00.000Z"; // 9:00 AM Edmonton

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  // What the OLD (buggy) code produced — UTC, no timeZone — for contrast.
  const buggy = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const newDateTime = fmt(newIso);
  const oldDateTime = fmt(oldIso);

  const template = bookingRescheduledEmail({
    clientName: "Brian (test)",
    orgName: "Svit Company Inc",
    serviceName: "Standard Cleaning",
    oldDateTime,
    newDateTime,
    address: "123 Test Ave (timezone verification)",
  });

  const sent = await sendEmail({
    to,
    toName: "Brian Musilek",
    subject: `[TEST] ${template.subject}`,
    html: template.html,
    text: template.text,
  });

  return NextResponse.json({
    sent,
    to,
    timezone: tz,
    fixed_newDateTime: newDateTime,
    fixed_oldDateTime: oldDateTime,
    buggy_would_have_shown: buggy(newIso),
  });
}
