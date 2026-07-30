import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * "Is anyone actually doing this job?" — the ONE answer.
 *
 * A booking can be covered three different ways, and code that checks only
 * the first two silently treats bench-covered work as unstaffed:
 *
 *   1. bookings.assigned_to        — the primary employee
 *   2. booking_assignees rows      — a crew
 *   3. a CLAIMED bench offer       — a freelancer
 *
 * (3) is the trap. Freelancers deliberately aren't memberships, and
 * bookings.assigned_to is a FK to memberships — so a claim structurally
 * CANNOT write it. Every automation keyed on assigned_to therefore reads a
 * fully-staffed job as empty: the unassigned-booking alert nags about it,
 * the coverage panel lists it as open, and the day-before reminder goes to
 * managers instead of the person actually turning up.
 *
 * Use this instead of hand-rolling the check.
 */

export type BookingCoverage = {
  staffed: boolean;
  /** Membership ids of assigned employees (primary + crew). */
  employeeIds: string[];
  /** freelancer_contacts ids that claimed a bench offer for this booking. */
  freelancerContactIds: string[];
};

const EMPTY: BookingCoverage = {
  staffed: false,
  employeeIds: [],
  freelancerContactIds: [],
};

/** Coverage for many bookings at once — one query per source, not per row. */
export async function resolveBookingCoverage(
  bookingIds: string[],
): Promise<Map<string, BookingCoverage>> {
  const out = new Map<string, BookingCoverage>();
  const ids = Array.from(new Set(bookingIds.filter(Boolean)));
  if (ids.length === 0) return out;
  for (const id of ids) {
    out.set(id, { staffed: false, employeeIds: [], freelancerContactIds: [] });
  }

  const db = createSupabaseAdminClient();

  const [primary, crew, offers] = await Promise.all([
    db
      .from("bookings")
      .select("id, assigned_to")
      .in("id", ids) as unknown as Promise<{
      data: Array<{ id: string; assigned_to: string | null }> | null;
    }>,
    db
      .from("booking_assignees")
      .select("booking_id, membership_id")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<{ booking_id: string; membership_id: string }> | null;
    }>,
    // A claim is what matters, not the offer's own status: a 1-of-2 filled
    // offer still means one real person is showing up.
    db
      .from("job_offer_claims")
      .select("contact_id, offer:job_offers ( booking_id )")
      .in("offer.booking_id" as never, ids as never) as unknown as Promise<{
      data: Array<{
        contact_id: string;
        offer: { booking_id: string } | null;
      }> | null;
    }>,
  ]);

  for (const b of primary.data ?? []) {
    if (!b.assigned_to) continue;
    const c = out.get(b.id);
    if (c) c.employeeIds.push(b.assigned_to);
  }
  for (const a of crew.data ?? []) {
    const c = out.get(a.booking_id);
    if (c && !c.employeeIds.includes(a.membership_id)) {
      c.employeeIds.push(a.membership_id);
    }
  }
  for (const claim of offers.data ?? []) {
    const bookingId = claim.offer?.booking_id;
    if (!bookingId) continue;
    const c = out.get(bookingId);
    if (c && !c.freelancerContactIds.includes(claim.contact_id)) {
      c.freelancerContactIds.push(claim.contact_id);
    }
  }

  for (const c of out.values()) {
    c.staffed = c.employeeIds.length > 0 || c.freelancerContactIds.length > 0;
  }
  return out;
}

/** Single-booking convenience wrapper. */
export async function isBookingStaffed(bookingId: string): Promise<boolean> {
  const map = await resolveBookingCoverage([bookingId]);
  return (map.get(bookingId) ?? EMPTY).staffed;
}
