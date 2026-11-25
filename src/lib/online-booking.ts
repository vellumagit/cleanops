import "server-only";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runtimeKnowsZone } from "@/lib/tz-probe";
import { zonedParts, zonedYmd } from "@/lib/wall-clock";
import { wallClockColumns } from "@/lib/scheduled-local";
import { timeLabel } from "@/lib/availability-week";
import { loadOpenTimes } from "@/lib/open-times-load";
import { onSiteMinutes } from "@/lib/open-times";
import { getOrgTimezone } from "@/lib/org-timezone";

/**
 * A visitor books a time on a company's page (roadmap phase 3).
 *
 * Two things live here: the open times as the PUBLIC may see them (a day
 * and its start times, nothing about who is free or why a day is empty),
 * and the save.
 *
 * The save trusts nothing the browser sent about the time. It works the
 * open times out again, on the server, and only books a start that is
 * still on the list.
 *
 * Nobody is put on the visit (Brian, 2026-11-25: it "leaves the power with
 * the office"). It goes in unstaffed, the office is emailed and the
 * dashboard asks for a cleaner. A time is only offered while enough of the
 * cleaners who take online bookings are free, and an unstaffed online
 * visit holds the people it will need (lib/open-times.ts), so the calendar
 * can't be sold twice over. The database saves online bookings one at a
 * time per company and checks for room inside that (migration
 * 20261125020000): of visitors pressing for the last free person at once,
 * one gets it and the rest are told the time was just taken.
 *
 * What it writes is an ordinary visit. Everything the office already does
 * with one (confirm, move, cancel, invoice) works on it unchanged.
 */
export type TimeBookingMode = "off" | "approve" | "instant";

const pad = (n: number) => String(n).padStart(2, "0");
const DAY = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** "Wednesday, March 3" for a day on the company's calendar. */
export const dayLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** "Wednesday, March 3 at 9:00 AM", on the company's clock. */
export function whenLabel(startMs: number, tz: string): string {
  const p = zonedParts(new Date(startMs), tz);
  return `${dayLabel(zonedYmd(new Date(startMs), tz))} at ${timeLabel(`${pad(p.hour)}:${pad(p.minute)}`)}`;
}

export type PublicDay = { ymd: string; label: string; times: Array<{ at: number; label: string }> };

/**
 * The days with open times, for a visitor: only days that have any, and
 * only the times. `nextFrom` is where "later days" would start, or null
 * when that is further ahead than the company takes bookings.
 */
export async function publicOpenTimes(input: {
  organizationId: string;
  serviceId: string;
  fromYmd?: string;
  now?: number;
}): Promise<{ ok: true; days: PublicDay[]; nextFrom: string | null } | { ok: false; error: string }> {
  const span = 14;
  const loaded = await loadOpenTimes({ organizationId: input.organizationId, serviceId: input.serviceId, fromYmd: input.fromYmd, days: span, now: input.now });
  if (!loaded.ok) return { ok: false, error: "This can't be booked online right now." };
  const days = loaded.days
    .filter((d) => d.times.length > 0)
    .map((d) => ({ ymd: d.ymd, label: dayLabel(d.ymd), times: d.times.map((t) => ({ at: t.startMs, label: timeLabel(t.hhmm) })) }));
  const last = loaded.days[loaded.days.length - 1];
  const more = last && last.reason !== "too_far";
  return { ok: true, days, nextFrom: more ? addDays(last.ymd, 1) : null };
}

export type BookTimeResult =
  | { ok: true; bookingId: string; status: "pending" | "confirmed"; when: string }
  /** The time is no longer open: someone took it, or the rules changed. */
  | { ok: false; taken: true }
  | { ok: false; taken?: false; error: string };

type BookInput = {
  organizationId: string;
  mode: Exclude<TimeBookingMode, "off">;
  serviceId: string;
  /** The start the visitor picked, as it came back from publicOpenTimes. */
  startMs: number;
  client: { id: string; name: string };
  address: string;
  /** The visitor's own words for this visit. */
  note: string;
  /** Where it was booked: the public page, or a signed-in client's own area. */
  via?: "page" | "client_area";
  now?: number;
};

/**
 * Book it. When the database refuses because another visitor got that
 * cleaner first, the times are worked out again and it is tried once or
 * twice more: with two cleaners free at ten, two visitors pressing at the
 * same moment should both get a visit, one each, not one visit and one
 * "that time was taken". When the time itself has gone, it says so.
 */
export async function bookTimeOnline(input: BookInput): Promise<BookTimeResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { lost, ...result } = await bookOnce(input);
    if (!lost) return result as BookTimeResult;
  }
  return { ok: false, taken: true };
}

async function bookOnce(input: BookInput): Promise<BookTimeResult & { lost?: boolean }> {
  const admin = createSupabaseAdminClient();
  const orgId = input.organizationId;
  if (!Number.isFinite(input.startMs)) return { ok: false, taken: true };

  // Worked out again, here, now. The day comes from the instant on the
  // company's clock, whatever the visitor's device thinks the date is.
  const tz = await getOrgTimezone(orgId);
  if (!runtimeKnowsZone(tz)) {
    // A visit stored an hour off is worse than one not taken (Alberta, 2026-11-01).
    return { ok: false, error: "We can't take online bookings right now. Please call us." };
  }
  const ymd = zonedYmd(new Date(input.startMs), tz);
  const loaded = await loadOpenTimes({ organizationId: orgId, serviceId: input.serviceId, fromYmd: ymd, days: 1, now: input.now });
  if (!loaded.ok) return { ok: false, error: "This can't be booked online right now." };
  const day = loaded.days[0];
  const slot = day?.times.find((t) => t.startMs === input.startMs);
  if (!day || !slot) return { ok: false, taken: true };

  const scheduledAt = new Date(input.startMs).toISOString();
  const status = input.mode === "instant" ? "confirmed" : "pending";
  // With nobody on it: the office chooses who. Saved by the database one
  // online booking at a time for this company, and only if the visits
  // nobody is on yet still leave enough of the free cleaners for this one
  // (migration 20261125020000). Checked from here after the insert, two
  // visitors saving at once could both stay.
  const endMs = input.startMs + onSiteMinutes(loaded.service.minutes, loaded.service.crewSize, loaded.shares) * 60_000;
  const { data: madeId, error: madeErr } = (await admin.rpc("insert_online_booking_if_room" as never, {
    p_row: {
      organization_id: orgId,
      client_id: input.client.id,
      scheduled_at: scheduledAt,
      ...wallClockColumns(`${ymd}T${slot.hhmm}`, tz),
      duration_minutes: loaded.service.minutes,
      service_type: loaded.service.category ?? "other",
      service_type_id: loaded.service.id,
      service_type_label: loaded.service.name,
      status,
      total_cents: Math.max(0, loaded.service.priceCents ?? 0),
      address: input.address || null,
      booked_online_at: new Date().toISOString(),
    },
    p_end: new Date(endMs).toISOString(),
    p_free: slot.cleaners.length,
    p_need: loaded.service.crewSize,
    p_gap_minutes: Math.max(0, loaded.rules.gapMinutes),
    p_shares: loaded.shares,
  } as never)) as unknown as { data: string | null; error: { message: string } | null };
  if (madeErr) {
    console.error("[online-booking] save failed:", madeErr.message);
    return { ok: false, error: "We couldn't save your booking. Try again in a moment." };
  }
  // No room: someone took the last free person a moment ago. Worked out
  // again, in case someone else is still free then.
  if (!madeId) return { ok: false, taken: true, lost: true };
  const made = { id: madeId };

  // A new visit: the job rules hear about it like any other.
  const { syncJob } = await import("@/lib/job-sync");
  await syncJob(made.id, "booked_online");

  // The visitor's words, where the crew reads "From the client, for today".
  const note = input.note.trim();
  if (note) {
    const { error: noteErr } = (await admin.from("client_job_requests" as never).insert({
      organization_id: orgId,
      client_id: input.client.id,
      booking_id: made.id,
      series_id: null,
      occurrence_date: ymd,
      kind: "job_note",
      body: note,
      status: "resolved",
      resolved_at: new Date().toISOString(),
      auto_applied: true,
    } as never)) as unknown as { error: { message: string } | null };
    if (noteErr) console.error("[online-booking] note not saved:", noteErr.message);
  }

  const when = whenLabel(input.startMs, tz);
  await afterBooking({ organizationId: orgId, bookingId: made.id, status, client: input.client, when, scheduledAt, service: loaded.service, address: input.address || null, via: input.via ?? "page" });

  for (const path of ["/app/bookings", "/app/calendar", "/app/scheduling", "/app", "/app/leads"]) revalidatePath(path);
  return { ok: true, bookingId: made.id, status, when };
}

/**
 * Tell the person who booked online that their visit is confirmed.
 *
 * The company's usual confirmation first (its template, its text message,
 * the client's own channel choices). But that one is an automation the
 * company may have switched off, and someone who booked on a public page
 * was promised an email on screen. So when the usual one sent no email,
 * a plain one goes out here. They asked for it, so the platform's "pause
 * client emails" doesn't apply.
 *
 * Used when a booking is made in "booked straight away" mode, and when the
 * office confirms a held one.
 */
export async function confirmOnlineBookingToClient(bookingId: string): Promise<void> {
  const { sendBookingConfirmation } = await import("@/lib/automations");
  await sendBookingConfirmation(bookingId);

  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("bookings")
    .select("organization_id, scheduled_at, service_type_label, address, confirmation_email_sent_at, client:clients ( name, email )" as never)
    .eq("id", bookingId)
    .maybeSingle()) as unknown as {
    data: {
      organization_id: string;
      scheduled_at: string;
      service_type_label: string | null;
      address: string | null;
      confirmation_email_sent_at: string | null;
      client: { name: string | null; email: string | null } | null;
    } | null;
  };
  if (!row || row.confirmation_email_sent_at || !row.client?.email) return;

  const [{ sendOrgEmail }, { visitLinkFor }] = await Promise.all([import("@/lib/email"), import("@/lib/visit-link")]);
  const { data: org } = (await admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle()) as unknown as {
    data: { name: string } | null;
  };
  const company = org?.name ?? "Your cleaner";
  const tz = await getOrgTimezone(row.organization_id);
  const when = whenLabel(new Date(row.scheduled_at).getTime(), tz);
  const what = row.service_type_label ?? "clean";
  const first = (row.client.name ?? "").trim().split(/\s+/)[0] || "there";
  const link = await visitLinkFor(bookingId, admin);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const sent = await sendOrgEmail(row.organization_id, {
    to: row.client.email,
    toName: row.client.name ?? undefined,
    pauseExempt: true,
    subject: `You're booked with ${company}`,
    html: `<p style="font-size:16px;">Hi ${esc(first)},</p>
<p style="font-size:16px;">Your ${esc(what)} with ${esc(company)} is confirmed for <strong>${esc(when)}</strong>${row.address ? ` at ${esc(row.address)}` : ""}.</p>
${link ? `<p style="font-size:16px;"><a href="${link}">See or change this visit</a></p>` : ""}`,
    text: `Hi ${first},\n\nYour ${what} with ${company} is confirmed for ${when}${row.address ? ` at ${row.address}` : ""}.${link ? `\n\nSee or change this visit: ${link}` : ""}`,
  });
  if (sent) {
    await admin.from("bookings").update({ confirmation_email_sent_at: new Date().toISOString() } as never).eq("id", bookingId);
  }
}

/**
 * Who hears about it. None of it can undo the booking: each part is tried
 * on its own and a failure is logged.
 */
async function afterBooking(b: {
  organizationId: string;
  bookingId: string;
  status: "pending" | "confirmed";
  client: { id: string; name: string };
  when: string;
  scheduledAt: string;
  service: { name: string; minutes: number; category: string | null };
  address: string | null;
  via: "page" | "client_area";
}) {
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      console.error(`[online-booking] ${what} failed:`, err);
    }
  };

  const where = b.via === "client_area" ? "from their client account" : "on your booking page";

  // The office: in the app, on the phone, and by email (Brian, 2026-11-25:
  // the bell alone was missed). Nobody is on the visit, so it says so.
  await attempt("office notice", async () => {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: b.organizationId,
      audience: "org-management",
      topic: "schedule",
      title: b.status === "pending" ? `Online booking to confirm: ${b.client.name}` : `New online booking: ${b.client.name}`,
      body:
        b.status === "pending"
          ? `${b.client.name} picked ${b.when} for ${b.service.name} ${where}. The time is held. Confirm it or decline it, and put a cleaner on it.`
          : `${b.client.name} booked ${b.service.name} for ${b.when} ${where}. Nobody is on it yet: put a cleaner on it.`,
      href: `/app/bookings/${b.bookingId}`,
      channels: { email: true },
    });
  });

  await attempt("calendar", async () => {
    const { createCalendarEvent } = await import("@/lib/google-calendar");
    const event = {
      id: b.bookingId,
      scheduled_at: b.scheduledAt,
      duration_minutes: b.service.minutes,
      service_type: b.service.category ?? "other",
      address: b.address,
      notes: null,
      client_name: b.client.name,
    };
    await createCalendarEvent(b.organizationId, event);
  });

  if (b.status === "confirmed") {
    // Confirmed: the client's usual confirmation, and a lead who has a
    // visit on the calendar is a client.
    await attempt("confirmation", () => confirmOnlineBookingToClient(b.bookingId));
    await attempt("lead conversion", async () => {
      const { convertLeadOnBooking } = await import("@/lib/lead-conversion");
      await convertLeadOnBooking(b.client.id);
    });
  }
}

/**
 * "Your time is held": for a booking the office confirms each of, so nobody
 * takes a day off work for it yet. The real confirmation goes out when the
 * office confirms. They asked for this, so the platform's "pause client
 * emails" doesn't apply. Best effort: the booking stands either way.
 */
export function sendHeldTimeEmail(args: {
  organizationId: string;
  to: string;
  name: string;
  company: string;
  when: string;
  service: string;
}): void {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const first = args.name.trim().split(/\s+/)[0] || "there";
  void import("@/lib/email")
    .then(({ sendOrgEmail }) =>
      sendOrgEmail(args.organizationId, {
        to: args.to,
        toName: args.name,
        pauseExempt: true,
        subject: `${args.company} is holding your time`,
        html: `<p style="font-size:16px;">Hi ${esc(first)},</p>
<p style="font-size:16px;">${esc(args.company)} is holding <strong>${esc(args.when)}</strong> for your ${esc(args.service)}.</p>
<p style="font-size:16px;">It isn't confirmed yet. You'll get another message as soon as ${esc(args.company)} confirms it.</p>
<p style="color:#666;font-size:13px;">If you didn't ask for this, you can ignore this message.</p>`,
        text: `Hi ${first},

${args.company} is holding ${args.when} for your ${args.service}.

It isn't confirmed yet. You'll get another message as soon as ${args.company} confirms it.

If you didn't ask for this, you can ignore this message.`,
      }),
    )
    .catch((err) => console.error("[online-booking] held-time email failed:", err));
}
