"use server";

import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { toDatetimeLocal } from "@/lib/wall-clock";
import { orgDividesCrewHours } from "@/lib/crew-hours";
import { membersOffOn } from "@/lib/unavailability-notice";
import {
  outsideHoursReason,
  pickReason,
  type Hours,
  type Unavailable,
} from "@/lib/crew-availability";

/**
 * Who can't take a visit at this time, and why: for the booking form's crew
 * picker, which then shows the people who are free and tucks the rest away.
 *
 * Four things make someone unavailable, the same four the office already
 * meets later, as a refused save or a declined job:
 *   - the visit falling after their last working day (the guard refuses it,
 *     migration 20261124010000),
 *   - approved time off, or the day marked unavailable (the board's grey
 *     stripes; lib/unavailability-notice membersOffOn),
 *   - another job at that time (the database's own overlap rule,
 *     booking_schedule_conflicts, so this can't disagree with the guard),
 *   - the visit falling outside the hours they said they work.
 *
 * How long each person is there follows the rule the overlap guard uses:
 * when the crew shares the visit's hours (the company's setting, or the
 * booking's own tick), N people are each there for the length divided by N.
 * So the answer depends on who is already picked: someone not yet on the
 * crew is judged as the next person added. Per-person times are not
 * modelled; the save's own check has the last word.
 *
 * A check, not a gate: a failure here returns ok:false and the form shows
 * everyone, as it always did.
 */

export type CrewAvailabilityResult =
  | { ok: true; unavailable: Record<string, Unavailable> }
  | { ok: false };

const OFFICE_ROLES = ["owner", "admin", "manager"];

export async function getCrewAvailabilityAction(input: {
  /** The form's datetime-local value: the company's wall clock. */
  scheduledAtLocal: string;
  durationMinutes: number;
  /** The visit being edited, so it doesn't count as its own clash. */
  excludeBookingId?: string | null;
  /** Who is picked so far. */
  crewIds?: string[];
  /** This visit's own "divide the hours" tick. The company's setting is
   *  read here and wins when it is on. */
  dividesHours?: boolean;
}): Promise<CrewAvailabilityResult> {
  try {
    const { membership } = await getActionContext();
    if (!OFFICE_ROLES.includes(membership.role)) return { ok: false };

    const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(input.scheduledAtLocal ?? "");
    if (!local) return { ok: false };
    const ymd = local[1];
    const startMinutes = Number(local[2]) * 60 + Number(local[3]);
    const minutes = Number.isFinite(input.durationMinutes) ? Math.max(0, Math.floor(input.durationMinutes)) : 0;
    const excludeId = /^[0-9a-f-]{36}$/i.test(input.excludeBookingId ?? "") ? (input.excludeBookingId as string) : null;

    const orgId = membership.organization_id;
    const tz = await getOrgTimezone(orgId);
    const startMs = new Date(localInputToUtcIso(`${ymd}T${local[2]}:${local[3]}`, tz)).getTime();
    if (Number.isNaN(startMs)) return { ok: false };
    const startIso = new Date(startMs).toISOString();
    const picked = new Set((input.crewIds ?? []).filter((id) => typeof id === "string"));
    const shares = input.dividesHours === true || (await orgDividesCrewHours(orgId));
    /** How long this person would be on site. */
    const minutesFor = (memberId: string): number => {
      const crew = picked.has(memberId) ? picked.size : picked.size + 1;
      return shares && crew >= 2 && minutes > 0 ? Math.max(1, Math.round(minutes / crew)) : minutes;
    };
    // No length typed yet: one minute, so "is someone there at that
    // moment" is still answered.
    const endIsoFor = (memberId: string) =>
      new Date(startMs + Math.max(1, minutesFor(memberId)) * 60_000).toISOString();

    const admin = createSupabaseAdminClient();
    const { data: people, error: peopleErr } = (await admin
      .from("memberships")
      .select("id, last_working_day" as never)
      .eq("organization_id", orgId)
      .eq("status", "active")) as unknown as {
      data: Array<{ id: string; last_working_day: string | null }> | null;
      error: { message: string } | null;
    };
    if (peopleErr) throw new Error(peopleErr.message);
    const ids = (people ?? []).map((p) => p.id);
    // Finished by the visit's date: their last working day is before it.
    const finishedBy = new Map<string, string>();
    for (const p of people ?? []) {
      if (p.last_working_day && ymd > p.last_working_day) finishedBy.set(p.id, p.last_working_day);
    }
    if (ids.length === 0) return { ok: true, unavailable: {} };

    const [off, slotsRes, customRes] = await Promise.all([
      membersOffOn(orgId, ids, ymd),
      admin
        .from("availability_slots" as never)
        .select("membership_id, day_of_week, start_time, end_time")
        .eq("organization_id" as never, orgId as never)
        .in("membership_id" as never, ids as never) as unknown as Promise<{
        data: Array<{ membership_id: string; day_of_week: number; start_time: string; end_time: string }> | null;
        error: { message: string } | null;
      }>,
      admin
        .from("availability_overrides" as never)
        .select("membership_id, start_time, end_time")
        .eq("organization_id" as never, orgId as never)
        .eq("kind" as never, "custom" as never)
        .eq("date" as never, ymd as never)
        .in("membership_id" as never, ids as never) as unknown as Promise<{
        data: Array<{ membership_id: string; start_time: string | null; end_time: string | null }> | null;
        error: { message: string } | null;
      }>,
    ]);
    if (slotsRes.error) throw new Error(slotsRes.error.message);
    if (customRes.error) throw new Error(customRes.error.message);

    const weekly = new Map<string, Record<number, Hours[]>>();
    for (const row of slotsRes.data ?? []) {
      const byDay = weekly.get(row.membership_id) ?? {};
      (byDay[row.day_of_week] ??= []).push({ start: row.start_time, end: row.end_time });
      weekly.set(row.membership_id, byDay);
    }
    const custom = new Map<string, Hours[]>();
    for (const row of customRes.data ?? []) {
      if (!row.start_time || !row.end_time) continue;
      custom.set(row.membership_id, [{ start: row.start_time, end: row.end_time }]);
    }

    // Another job at that time. Asked per person, because the database
    // answers "which bookings", not "whose"; a handful at a time so a big
    // team doesn't open thirty connections at once.
    const clashes = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 6) {
      await Promise.all(
        ids.slice(i, i + 6).map(async (memberId) => {
          const { data, error } = await admin.rpc("booking_schedule_conflicts" as never, {
            p_organization_id: orgId,
            p_booking_id: excludeId,
            p_proposed_windows: [{ membership_id: memberId, start_at: startIso, end_at: endIsoFor(memberId) }],
          } as never);
          if (error) throw new Error((error as { message: string }).message);
          // `returns setof uuid` arrives as bare strings; tolerate a wrapped row.
          // The visit itself coming back means "finished by then", which is
          // read from last_working_day above; it is not another job.
          const found = ((data ?? []) as unknown[])
            .map((row) => (typeof row === "string" ? row : (Object.values((row ?? {}) as object)[0] as string)))
            .filter((id): id is string => typeof id === "string" && id !== excludeId);
          if (found.length > 0) clashes.set(memberId, found);
        }),
      );
    }

    const jobs = new Map<string, { scheduled_at: string; client: string }>();
    const jobIds = [...new Set([...clashes.values()].flat())];
    for (let i = 0; i < jobIds.length; i += 150) {
      const { data, error } = (await admin
        .from("bookings")
        .select("id, scheduled_at, client:clients ( name )")
        .eq("organization_id", orgId)
        .in("id", jobIds.slice(i, i + 150))) as unknown as {
        data: Array<{ id: string; scheduled_at: string; client: { name: string | null } | null }> | null;
        error: { message: string } | null;
      };
      if (error) throw new Error(error.message);
      for (const b of data ?? []) jobs.set(b.id, { scheduled_at: b.scheduled_at, client: b.client?.name ?? "another client" });
    }
    const clock = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const busyReason = (memberId: string): string | null => {
      const found = (clashes.get(memberId) ?? [])
        .map((id) => jobs.get(id))
        .filter((j): j is { scheduled_at: string; client: string } => !!j)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      if ((clashes.get(memberId) ?? []).length === 0) return null;
      if (found.length === 0) return "On another job then";
      const first = found[0];
      const more = found.length - 1;
      return `On another job then: ${first.client}, ${clock.format(new Date(first.scheduled_at))}${more > 0 ? `, and ${more} more` : ""}`;
    };

    const offSet = new Set(off);
    const dayOfWeek = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    const unavailable: Record<string, Unavailable> = {};
    for (const id of ids) {
      const reason = pickReason({
        finished: finishedBy.get(id) ?? null,
        off: offSet.has(id),
        busy: busyReason(id),
        hours: outsideHoursReason({
          dayOfWeek,
          startMinutes,
          durationMinutes: minutesFor(id),
          weekly: weekly.get(id) ?? {},
          custom: custom.get(id) ?? null,
        }),
      });
      if (reason) unavailable[id] = reason;
    }
    return { ok: true, unavailable };
  } catch (err) {
    console.error("[bookings] could not check who is free:", err);
    return { ok: false };
  }
}

/**
 * The same question for a visit that already exists: the "Change crew"
 * pop-up, which knows the booking but not its time.
 */
export async function getCrewAvailabilityForBookingAction(
  bookingId: string,
  /** Who is ticked in the pop-up right now. */
  crewIds: string[] = [],
): Promise<CrewAvailabilityResult> {
  try {
    const { membership } = await getActionContext();
    if (!OFFICE_ROLES.includes(membership.role)) return { ok: false };
    if (!/^[0-9a-f-]{36}$/i.test(bookingId ?? "")) return { ok: false };
    const { data: booking, error } = (await createSupabaseAdminClient()
      .from("bookings")
      .select("id, scheduled_at, duration_minutes, divide_hours_evenly")
      .eq("id", bookingId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as {
      data: { id: string; scheduled_at: string; duration_minutes: number | null; divide_hours_evenly: boolean | null } | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    if (!booking) return { ok: false };
    const tz = await getOrgTimezone(membership.organization_id);
    return await getCrewAvailabilityAction({
      scheduledAtLocal: toDatetimeLocal(new Date(booking.scheduled_at).toISOString(), tz),
      durationMinutes: booking.duration_minutes ?? 0,
      excludeBookingId: booking.id,
      crewIds,
      dividesHours: booking.divide_hours_evenly === true,
    });
  } catch (err) {
    console.error("[bookings] could not check who is free for a booking:", err);
    return { ok: false };
  }
}
