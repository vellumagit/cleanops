import { getCurrentClient } from "@/lib/client-auth";
import { getOrgName } from "@/lib/org-name";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * "I forgot the cleaner is coming."
 *
 * Svitlana's ask, wearing her client hat: the visit should be able to live in
 * HER calendar, not just the company's. This hands back a one-event .ics —
 * the format every calendar app has agreed on since before smartphones — for
 * the visit the client is looking at. Apple and Outlook open it natively;
 * the page pairs it with a Google Calendar link for everyone else.
 *
 * AUTH IS IN THE HANDLER, not inherited — route handlers stand outside
 * layouts entirely, so this file turns away unauthenticated hits itself, and
 * the booking must belong to THIS client or a guessed id walks through.
 * Lives under /api rather than nested in the portal's route group because
 * Turbopack refuses to register a handler under the group's dynamic page
 * segment — a clean build 404'd it; this flat path registers first try.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await getCurrentClient();
  if (!client) {
    return new Response("Sign in to your portal to download this.", {
      status: 401,
    });
  }

  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const { data: booking } = (await admin
    .from("bookings")
    .select("id, client_id, scheduled_at, duration_minutes, address, status")
    .eq("id", id)
    .eq("client_id", client.id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      client_id: string;
      scheduled_at: string;
      duration_minutes: number | null;
      address: string | null;
      status: string;
    } | null;
  };

  if (!booking || booking.status === "cancelled") {
    return new Response("Not found", { status: 404 });
  }

  const orgName = await getOrgName(client.organization_id);
  const start = new Date(booking.scheduled_at);
  const end = new Date(
    start.getTime() + (booking.duration_minutes ?? 120) * 60_000,
  );

  // UTC basic format — calendar apps localize on display, so the client sees
  // it at their own wall-clock time whatever device they open it on.
  const stamp = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => `\\${m}`);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sollos//Client Portal//EN",
    "BEGIN:VEVENT",
    `UID:booking-${booking.id}@sollos3.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`Cleaning — ${orgName}`)}`,
    ...(booking.address ? [`LOCATION:${esc(booking.address)}`] : []),
    `DESCRIPTION:${esc(`Your cleaning with ${orgName}. Details and changes: your client portal.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cleaning.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
