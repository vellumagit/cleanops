import "server-only";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowDbErrors } from "@/lib/supabase/query-guard";
import { isDoubleBookingError } from "@/lib/crew-clash-text";
import { getOrgTimezone } from "@/lib/org-timezone";
import { runtimeKnowsZone } from "@/lib/tz-probe";
import { zonedYmd } from "@/lib/wall-clock";
import { scheduleFromWallClock } from "@/lib/scheduled-local";
import { timeLabel } from "@/lib/availability-week";
import { loadOpenTimes } from "@/lib/open-times-load";
import { dayLabel, whenLabel, type PublicDay } from "@/lib/online-booking";
import { clientBookingActions, MAX_SELF_MOVES, occurrenceDate, SKIP_AUTO_APPLY_HOURS } from "@/lib/client-job-requests";

/**
 * A client moves their own visit to another open time (roadmap phase 4).
 *
 * From the private link in a booking email, or signed in. Offered only
 * when all of these hold, and the page says which one doesn't:
 *
 *   - the company lets visitors book a time straight away (Settings,
 *     Online booking). A company that confirms each booking, or takes
 *     requests only, gets "ask to move" instead: a person answers.
 *   - the visit is still ahead by the company's notice period.
 *   - it has a crew, all on the visit's own times. The same people keep the
 *     job; a time is open when every one of them is free. Or it was booked
 *     online and nobody is on it yet (online bookings are left for the
 *     office to staff): then a time is open as it was when it was booked,
 *     when enough of the cleaners who take online bookings are free.
 *   - it hasn't already been moved by the client a few times.
 *
 * The new time comes from the same open-times engine the booking page
 * uses, worked out again in the save, and the move itself is the database
 * call the scheduler's drag uses, so the double-booking guard decides.
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MovableVisit = {
  id: string;
  organization_id: string;
  client_id: string;
  series_id: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  archived_at: string | null;
  assigned_to: string | null;
  service_type_label: string | null;
  service_type: string;
};

export type ChangeRules = {
  /** Hours before a visit up to which the client can change it themselves. */
  noticeHours: number;
  /** The company lets a client pick a new time themselves. */
  selfMove: boolean;
};

/** The company's rules for client changes. No page, or an older database: 48 hours, no self-move. */
export async function clientChangeRules(organizationId: string, admin: Admin = createSupabaseAdminClient()): Promise<ChangeRules> {
  const fallback: ChangeRules = { noticeHours: SKIP_AUTO_APPLY_HOURS, selfMove: false };
  try {
    const { data, error } = (await admin
      .from("booking_pages" as never)
      .select("change_notice_hours, time_booking")
      .eq("organization_id" as never, organizationId as never)
      .maybeSingle()) as unknown as { data: { change_notice_hours: number | null; time_booking: string | null } | null; error: { message: string } | null };
    if (error || !data) return fallback;
    const hours = Number(data.change_notice_hours);
    return {
      noticeHours: Number.isFinite(hours) && hours >= 0 ? Math.min(720, Math.round(hours)) : SKIP_AUTO_APPLY_HOURS,
      selfMove: data.time_booking === "instant",
    };
  } catch {
    return fallback;
  }
}

/** Who is on the visit. `unstaffedNeed`: booked online, nobody on it yet, and how many it needs. */
type Crew = { ids: string[]; ownTimes: boolean; dividesHours: boolean; unstaffedNeed: number | null };

async function crewOf(visit: MovableVisit, admin: Admin): Promise<Crew> {
  const [rowsRes, bookingRes] = await Promise.all([
    admin.from("booking_assignees").select("membership_id, split_start_offset_minutes, split_duration_minutes").eq("booking_id", visit.id) as unknown as Promise<{
      data: Array<{ membership_id: string; split_start_offset_minutes: number | null; split_duration_minutes: number | null }> | null;
    }>,
    admin
      .from("bookings")
      .select("splits, divide_hours_evenly, booked_online_at, service:service_types ( online_crew_size )" as never)
      .eq("id", visit.id)
      .maybeSingle() as unknown as Promise<{
      data: {
        splits: unknown;
        divide_hours_evenly: boolean | null;
        booked_online_at: string | null;
        service: { online_crew_size: number | null } | null;
      } | null;
    }>,
  ]);
  const rows = rowsRes.data ?? [];
  const ids = Array.from(new Set([...(visit.assigned_to ? [visit.assigned_to] : []), ...rows.map((r) => r.membership_id)]));
  const splits = bookingRes.data?.splits;
  return {
    ids,
    ownTimes: (Array.isArray(splits) && splits.length > 0) || rows.some((r) => r.split_start_offset_minutes != null || r.split_duration_minutes != null),
    dividesHours: bookingRes.data?.divide_hours_evenly === true,
    unstaffedNeed:
      ids.length === 0 && bookingRes.data?.booked_online_at ? Math.max(1, bookingRes.data.service?.online_crew_size ?? 1) : null,
  };
}

async function movesSoFar(visit: MovableVisit, admin: Admin): Promise<number> {
  const { count } = (await admin
    .from("client_job_requests" as never)
    .select("id", { count: "exact", head: true })
    .eq("booking_id" as never, visit.id as never)
    .eq("kind" as never, "job_note" as never)
    .like("body" as never, "Moved their visit from %" as never)) as unknown as { count: number | null };
  return count ?? 0;
}

export type MoveState = { allowed: true; crew: Crew; rules: ChangeRules } | { allowed: false; reason: string; rules: ChangeRules };

/** Can this client move this visit themselves, right now? */
export async function visitMoveState(visit: MovableVisit, now: number = Date.now()): Promise<MoveState> {
  const admin = createSupabaseAdminClient();
  const rules = await clientChangeRules(visit.organization_id, admin);
  const no = (reason: string): MoveState => ({ allowed: false, reason, rules });
  const state = clientBookingActions(visit, now, rules.noticeHours);
  if (!state.canSkip) return no(state.reason ?? "This visit can't be changed here.");
  if (!rules.selfMove) return no("To move this visit, ask us and we'll find a time with you.");
  if (!state.skipAutoApplies) {
    return no(
      rules.noticeHours > 0
        ? `This visit is less than ${rules.noticeHours} hours away, so it can't be moved here. Call us and we'll help.`
        : "This visit can't be moved here. Call us and we'll help.",
    );
  }
  if (!visit.duration_minutes || visit.duration_minutes <= 0) return no("To move this visit, ask us and we'll find a time with you.");
  const crew = await crewOf(visit, admin);
  if ((crew.ids.length === 0 && crew.unstaffedNeed == null) || crew.ownTimes) {
    return no("To move this visit, ask us and we'll find a time with you.");
  }
  if ((await movesSoFar(visit, admin)) >= MAX_SELF_MOVES) {
    return no("This visit has been moved a few times already. To move it again, call us.");
  }
  return { allowed: true, crew, rules };
}

/** The open days and times this visit could move to. Never its current time. */
export async function visitOpenTimes(
  visit: MovableVisit,
  fromYmd?: string,
  now?: number,
): Promise<{ ok: true; days: PublicDay[]; nextFrom: string | null } | { ok: false; error: string }> {
  const state = await visitMoveState(visit, now);
  if (!state.allowed) return { ok: false, error: state.reason };
  const loaded = await loadOpenTimes({
    organizationId: visit.organization_id,
    visit: {
      bookingId: visit.id,
      durationMinutes: visit.duration_minutes ?? 0,
      crewIds: state.crew.ids,
      dividesHours: state.crew.dividesHours,
      crewSize: state.crew.unstaffedNeed ?? undefined,
    },
    fromYmd,
    days: 14,
    now,
  });
  if (!loaded.ok) return { ok: false, error: "This visit can't be moved here. Call us and we'll help." };
  const current = new Date(visit.scheduled_at).getTime();
  const days = loaded.days
    .map((d) => ({ ymd: d.ymd, label: dayLabel(d.ymd), times: d.times.filter((t) => t.startMs !== current).map((t) => ({ at: t.startMs, label: timeLabel(t.hhmm) })) }))
    .filter((d) => d.times.length > 0);
  const last = loaded.days[loaded.days.length - 1];
  const more = last && last.reason !== "too_far";
  return { ok: true, days, nextFrom: more ? new Date(Date.parse(`${last.ymd}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null };
}

export type MoveResult = { ok: true; when: string } | { ok: false; taken: true } | { ok: false; taken?: false; error: string };

export async function moveVisit(client: { id: string; name: string }, visit: MovableVisit, startMs: number, now?: number): Promise<MoveResult> {
  if (!Number.isFinite(startMs)) return { ok: false, taken: true };
  const state = await visitMoveState(visit, now);
  if (!state.allowed) return { ok: false, error: state.reason };
  const admin = createSupabaseAdminClient();
  const orgId = visit.organization_id;
  const tz = await getOrgTimezone(orgId);
  if (!runtimeKnowsZone(tz)) return { ok: false, error: "We can't move visits online right now. Please call us." };
  const oldAt = visit.scheduled_at;
  if (new Date(oldAt).getTime() === startMs) return { ok: false, error: "That is the time it is already booked for." };

  // Worked out again, here: only a start still on the list.
  const ymd = zonedYmd(new Date(startMs), tz);
  const loaded = await loadOpenTimes({
    organizationId: orgId,
    visit: {
      bookingId: visit.id,
      durationMinutes: visit.duration_minutes ?? 0,
      crewIds: state.crew.ids,
      dividesHours: state.crew.dividesHours,
      crewSize: state.crew.unstaffedNeed ?? undefined,
    },
    fromYmd: ymd,
    days: 1,
    now,
  });
  const slot = loaded.ok ? loaded.days[0]?.times.find((t) => t.startMs === startMs) : null;
  if (!slot) return { ok: false, taken: true };

  const wall = scheduleFromWallClock(`${ymd}T${slot.hhmm}`, tz);
  // 23P01: the database refusing a cleaner who is booked then. Expected
  // when someone else took the time a moment ago.
  const { error } = (await allowDbErrors(
    ["23P01"],
    admin.rpc("reschedule_booking_with_assignees" as never, {
      p_organization_id: orgId,
      p_booking_id: visit.id,
      p_scheduled_at: wall.scheduled_at,
      p_scheduled_local: wall.scheduled_local,
      p_scheduled_tz: wall.scheduled_tz,
      p_set_assigned_to: false,
      p_assigned_to: null,
      p_reset_client_reminder: true,
      p_time_set_by_hand_at: new Date().toISOString(),
      p_assignee_ids: null,
    } as never),
  )) as unknown as { error: { code?: string | null; message: string } | null };
  const lostTheRace = error?.code === "23P01" || isDoubleBookingError(error);
  if (error) {
    if (lostTheRace) return { ok: false, taken: true };
    console.error("[visit-move] move failed:", error.message);
    return { ok: false, error: "We couldn't move your visit. Try again in a moment." };
  }

  const was = whenLabel(new Date(oldAt).getTime(), tz);
  const when = whenLabel(startMs, tz);
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      console.error(`[visit-move] ${what} failed:`, err);
    }
  };

  // On the record, so the office can see who moved it and from when. Also
  // what counts the moves (movesSoFar reads this sentence's opening).
  await attempt("record", async () => {
    const { error: recErr } = (await admin.from("client_job_requests" as never).insert({
      organization_id: orgId,
      client_id: client.id,
      booking_id: visit.id,
      series_id: visit.series_id,
      occurrence_date: occurrenceDate(wall.scheduled_at, tz),
      kind: "job_note",
      body: `Moved their visit from ${was} to ${when}.`,
      status: "resolved",
      resolved_at: new Date().toISOString(),
      auto_applied: true,
    } as never)) as unknown as { error: { message: string } | null };
    if (recErr) throw new Error(recErr.message);
  });
  await attempt("job rules", async () => {
    const { syncJob } = await import("@/lib/job-sync");
    await syncJob(visit.id, "client_moved");
  });
  // The office is told of every change.
  await attempt("office notice", async () => {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: orgId,
      audience: "org-management",
      topic: "clients",
      type: "client_request",
      title: `${client.name} moved a visit`,
      body: `${visit.service_type_label ?? visit.service_type.replace(/_/g, " ")}: from ${was} to ${when}. ${state.crew.ids.length > 0 ? "The same crew is on it." : "Nobody is on it yet: put a cleaner on it."}`,
      href: `/app/bookings/${visit.id}`,
    });
  });
  // The client's "rescheduled" message and the crew's push, the way a move
  // on the scheduler sends them.
  await attempt("rescheduled notices", async () => {
    const { sendBookingRescheduled } = await import("@/lib/automations");
    await sendBookingRescheduled(visit.id, oldAt);
  });
  await attempt("calendars", async () => {
    const { resyncBookingCalendars } = await import("@/lib/booking-calendar-sync");
    await resyncBookingCalendars(visit.id);
  });

  for (const path of [`/client/jobs/${visit.id}`, "/client/jobs", "/client", `/field/jobs/${visit.id}`, `/app/bookings/${visit.id}`, "/app/bookings", "/app/scheduling", "/app/calendar", "/app"]) {
    revalidatePath(path);
  }
  return { ok: true, when };
}
