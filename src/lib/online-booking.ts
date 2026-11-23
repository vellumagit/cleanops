import "server-only";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowDbErrors } from "@/lib/supabase/query-guard";
import { isDoubleBookingError } from "@/lib/crew-clash-text";
import { runtimeKnowsZone } from "@/lib/tz-probe";
import { zonedParts, zonedYmd } from "@/lib/wall-clock";
import { wallClockColumns } from "@/lib/scheduled-local";
import { timeLabel } from "@/lib/availability-week";
import { loadOpenTimes } from "@/lib/open-times-load";
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
 * still on the list. The visit is given to the cleaners with the fewest
 * jobs that day, through the same database call the office's crew save
 * uses, so the double-booking guard has the last word: of two visitors
 * pressing at the same moment, the database refuses one, the half-made
 * visit is removed, and that person is told the time was just taken.
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
  | { ok: true; bookingId: string; status: "pending" | "confirmed"; when: string; crew: string[] }
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

  // Fewest jobs that day first; then by id, so the choice is steady.
  const crew = [...slot.cleaners]
    .sort((a, b) => (day.jobs[a] ?? 0) - (day.jobs[b] ?? 0) || a.localeCompare(b))
    .slice(0, loaded.service.crewSize);
  if (crew.length < loaded.service.crewSize) return { ok: false, taken: true };

  const scheduledAt = new Date(input.startMs).toISOString();
  const status = input.mode === "instant" ? "confirmed" : "pending";
  // The visit first, with nobody on it: the guard checks a lead the moment
  // the row exists, at the whole job's hours, where her share of a job two
  // people split is half. The crew goes on together, below.
  const { data: made, error: madeErr } = (await admin
    .from("bookings")
    .insert({
      organization_id: orgId,
      client_id: input.client.id,
      assigned_to: null,
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
    } as never)
    .select("id")
    .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (madeErr || !made) {
    console.error("[online-booking] insert failed:", madeErr?.message);
    return { ok: false, error: "We couldn't save your booking. Try again in a moment." };
  }

  // 23P01: the database refusing a cleaner who is already booked then.
  // Expected when two visitors press at once; answered below.
  const { error: crewErr } = (await allowDbErrors(
    ["23P01"],
    admin.rpc("update_booking_assignments_v2" as never, {
      p_organization_id: orgId,
      p_booking_ids: [made.id],
      p_booking_patch: { assigned_to: crew[0] },
      p_assignees: crew.map((membershipId, i) => ({
        organization_id: orgId,
        booking_id: made.id,
        membership_id: membershipId,
        is_primary: i === 0,
        split_index: null,
        split_start_offset_minutes: null,
        split_duration_minutes: null,
        acceptance_status: "pending",
        responded_at: null,
        completed_at: null,
      })),
    } as never),
  )) as unknown as { error: { code?: string | null; message: string } | null };
  const lostTheRace = crewErr?.code === "23P01" || isDoubleBookingError(crewErr);
  if (crewErr) {
    // Nothing half-made is left on the calendar.
    const { error: undoErr } = await admin.from("bookings").delete().eq("id", made.id).eq("organization_id", orgId);
    if (undoErr) console.error("[online-booking] could not remove a half-made visit:", made.id, undoErr.message);
    if (lostTheRace) return { ok: false, taken: true, lost: true };
    console.error("[online-booking] crew save failed:", crewErr.message);
    return { ok: false, error: "We couldn't save your booking. Try again in a moment." };
  }

  // A new visit with a crew: the job rules hear about it like any other.
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
  await afterBooking({ organizationId: orgId, bookingId: made.id, status, crew, client: input.client, when, scheduledAt, service: loaded.service, address: input.address || null });

  for (const path of ["/app/bookings", "/app/calendar", "/app/scheduling", "/app", "/app/leads"]) revalidatePath(path);
  return { ok: true, bookingId: made.id, status, when, crew };
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
  crew: string[];
  client: { id: string; name: string };
  when: string;
  scheduledAt: string;
  service: { name: string; minutes: number; category: string | null };
  address: string | null;
}) {
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      console.error(`[online-booking] ${what} failed:`, err);
    }
  };

  // The office, in the app: the trace if every other message is lost.
  await attempt("office notice", async () => {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: b.organizationId,
      audience: "org-management",
      topic: "schedule",
      title: b.status === "pending" ? "Online booking to confirm" : "Booked online",
      body:
        b.status === "pending"
          ? `${b.client.name} picked ${b.when} for ${b.service.name} on your booking page. The time is held. Confirm it or decline it.`
          : `${b.client.name} booked ${b.service.name} for ${b.when} on your booking page.`,
      href: `/app/bookings/${b.bookingId}`,
    });
  });

  // The crew, the way the office's own new booking tells them.
  await attempt("crew notice", async () => {
    const { notifyBookingAssignment } = await import("@/lib/automations");
    for (const membershipId of b.crew) {
      await notifyBookingAssignment(b.organizationId, b.bookingId, membershipId, {
        clientName: b.client.name,
        scheduledAt: b.scheduledAt,
        serviceType: b.service.category ?? "other",
        address: b.address,
      });
    }
  });

  await attempt("calendar", async () => {
    const { createCalendarEvent, syncMemberCalendarEvents } = await import("@/lib/google-calendar");
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
    await syncMemberCalendarEvents(b.bookingId, b.crew, event);
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
