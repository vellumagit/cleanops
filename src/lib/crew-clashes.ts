import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";
import { orgDividesCrewHours } from "@/lib/crew-hours";
import {
  clashMessage,
  proposedWindows,
  type CrewClash,
  type ProposedVisit,
} from "@/lib/crew-clash-text";

/**
 * Which jobs a proposed crew is already on, for the visits being saved.
 *
 * Asked only after the database has refused a save for double-booking, to
 * turn "A cleaner already has an overlapping booking" into who, which job
 * and when. The database decides what overlaps: this calls its own
 * booking_schedule_conflicts (migration 20261108060000), once per person,
 * rather than re-deciding it here, so the list can't disagree with the
 * refusal about shared hours or per-person times.
 *
 * One difference worth knowing: the guard refuses only a clash the change
 * ADDS, and this lists every clash the proposed crew has, including one
 * that was already there. More information than the refusal strictly
 * needs, never less.
 */
export async function findCrewClashes(
  admin: SupabaseClient,
  organizationId: string,
  visits: ProposedVisit[],
  /** Bookings this save replaces (a series being re-dated): the proposed
   *  crew is on them today, and they are about to go. */
  ignoreBookingIds: string[] = [],
): Promise<CrewClash[]> {
  const windowsByMember = proposedWindows(visits);
  if (windowsByMember.size === 0) return [];

  // The visits being saved are not clashes with themselves.
  const own = new Set([
    ...visits.map((v) => v.bookingId).filter((id): id is string => !!id),
    ...ignoreBookingIds,
  ]);
  const onlyBooking = visits.length === 1 ? visits[0].bookingId : null;

  const clashingByMember = new Map<string, string[]>();
  for (const [memberId, windows] of windowsByMember) {
    const { data, error } = await admin.rpc("booking_schedule_conflicts", {
      p_organization_id: organizationId,
      p_booking_id: onlyBooking,
      p_proposed_windows: windows.map((w) => ({ membership_id: memberId, ...w })),
    });
    if (error) throw new Error(error.message);
    // `returns setof uuid` arrives as bare strings; tolerate a wrapped row.
    const ids = ((data ?? []) as unknown[])
      .map((row) => (typeof row === "string" ? row : (Object.values((row ?? {}) as object)[0] as string)))
      .filter((id): id is string => typeof id === "string" && !own.has(id));
    if (ids.length > 0) clashingByMember.set(memberId, ids);
  }
  if (clashingByMember.size === 0) return [];

  const bookingIds = [...new Set([...clashingByMember.values()].flat())];
  const jobs = new Map<string, { scheduled_at: string; client: string }>();
  for (let i = 0; i < bookingIds.length; i += 150) {
    const { data, error } = (await admin
      .from("bookings")
      .select("id, scheduled_at, client:clients ( name )")
      .eq("organization_id", organizationId)
      .in("id", bookingIds.slice(i, i + 150))) as unknown as {
      data: Array<{ id: string; scheduled_at: string; client: { name: string | null } | null }> | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    for (const b of data ?? []) jobs.set(b.id, { scheduled_at: b.scheduled_at, client: b.client?.name ?? "another job" });
  }

  const { data: people, error: peopleErr } = (await admin
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .eq("organization_id", organizationId)
    .in("id", [...clashingByMember.keys()])) as unknown as {
    data: Array<{ id: string; display_name: string | null; profile: { full_name: string | null } | null }> | null;
    error: { message: string } | null;
  };
  if (peopleErr) throw new Error(peopleErr.message);
  const names = new Map((people ?? []).map((m) => [m.id, memberDisplayName(m)]));

  const clashes: CrewClash[] = [];
  for (const [memberId, ids] of clashingByMember) {
    for (const id of ids) {
      const job = jobs.get(id);
      if (!job) continue;
      clashes.push({
        memberId,
        memberName: names.get(memberId) ?? "A cleaner",
        bookingId: id,
        clientName: job.client,
        scheduledAt: job.scheduled_at,
      });
    }
  }
  return clashes;
}

type VisitInput = Omit<ProposedVisit, "dividesHours"> & { divideHoursEvenly?: boolean | null };

/**
 * findCrewClashes with the company's shared-hours setting read for the
 * caller. Throws on a failed read.
 */
export async function clashesFor(
  admin: SupabaseClient,
  organizationId: string,
  visits: VisitInput[],
  ignoreBookingIds: string[] = [],
): Promise<CrewClash[]> {
  if (visits.length === 0) return [];
  const orgDivides = await orgDividesCrewHours(organizationId);
  return findCrewClashes(
    admin,
    organizationId,
    visits.map((v) => ({
      bookingId: v.bookingId,
      scheduledAt: v.scheduledAt,
      durationMinutes: v.durationMinutes,
      crew: v.crew,
      dividesHours: v.divideHoursEvenly === true || orgDivides,
    })),
    ignoreBookingIds,
  );
}

/**
 * Who on a saved visit is also on another job at the same time: a visit
 * someone kept with "Book anyway", or one from before the guard. Read for
 * the visit's own page. Empty for a visit that is finished or cancelled.
 */
export async function clashesOnVisit(
  admin: SupabaseClient,
  organizationId: string,
  bookingId: string,
  /** asIfLive: the visit is cancelled and about to be brought back, so the
   *  question is who would be double-booked once it is live again. */
  opts: { asIfLive?: boolean } = {},
): Promise<CrewClash[]> {
  const { data: b, error } = (await admin
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, divide_hours_evenly, assigned_to, status")
    .eq("organization_id", organizationId)
    .eq("id", bookingId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      scheduled_at: string;
      duration_minutes: number | null;
      divide_hours_evenly: boolean | null;
      assigned_to: string | null;
      status: string;
    } | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  if (!b || b.status === "completed") return [];
  if (b.status === "cancelled" && !opts.asIfLive) return [];
  const { data: rows, error: rowsErr } = (await admin
    .from("booking_assignees")
    .select("membership_id, split_start_offset_minutes, split_duration_minutes")
    .eq("booking_id", bookingId)) as unknown as {
    data: Array<{
      membership_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
    }> | null;
    error: { message: string } | null;
  };
  if (rowsErr) throw new Error(rowsErr.message);
  const crew = (rows ?? []).map((r) => ({
    membershipId: r.membership_id,
    startOffsetMinutes: r.split_start_offset_minutes,
    durationMinutes: r.split_duration_minutes,
  }));
  if (b.assigned_to && !crew.some((c) => c.membershipId === b.assigned_to)) {
    crew.push({ membershipId: b.assigned_to, startOffsetMinutes: null, durationMinutes: null });
  }
  return clashesFor(admin, organizationId, [
    {
      bookingId: b.id,
      scheduledAt: b.scheduled_at,
      durationMinutes: b.duration_minutes ?? 0,
      divideHoursEvenly: b.divide_hours_evenly,
      crew,
    },
  ]);
}

/**
 * The refusal in words for these visits, or null when no clash could be
 * named (the caller then keeps its plain sentence). Never throws: this runs
 * on the way to showing an error, and a second failure there must not hide
 * the first.
 */
export async function explainDoubleBooking(
  admin: SupabaseClient,
  organizationId: string,
  visits: VisitInput[],
  ignoreBookingIds: string[] = [],
): Promise<string | null> {
  return (await describeDoubleBooking(admin, organizationId, visits, ignoreBookingIds))?.message ?? null;
}

/**
 * The same, with the clashes themselves, for a save that may offer "Book
 * anyway". Never throws.
 */
export async function describeDoubleBooking(
  admin: SupabaseClient,
  organizationId: string,
  visits: VisitInput[],
  ignoreBookingIds: string[] = [],
  opts: { canBookAnyway?: boolean } = {},
): Promise<{ message: string; clashes: CrewClash[] } | null> {
  try {
    if (visits.length === 0) return null;
    const [clashes, tz] = await Promise.all([
      clashesFor(admin, organizationId, visits, ignoreBookingIds),
      getOrgTimezone(organizationId),
    ]);
    const message = clashMessage(clashes, {
      tz,
      visitCount: visits.length,
      canBookAnyway: opts.canBookAnyway && visits.length === 1,
    });
    return message ? { message, clashes } : null;
  } catch (err) {
    console.error("[crew-clashes] could not name the clash:", err);
    return null;
  }
}
