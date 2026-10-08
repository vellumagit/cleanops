import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { selectInChunks } from "@/lib/supabase/chunked-in";

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

  // Chunked: callers pass up to 1,000 ids (the bookings list), and one
  // `in` filter that long overflows the request URL — all three of these
  // used to fail together and read every job as unstaffed.
  const [primary, crew, offers] = await Promise.all([
    selectInChunks(ids, (chunk) =>
      db
        .from("bookings")
        .select("id, assigned_to")
        .in("id", chunk) as unknown as Promise<{
        data: Array<{ id: string; assigned_to: string | null }> | null;
        error: { message: string } | null;
      }>,
    ),
    selectInChunks(ids, (chunk) =>
      db
        .from("booking_assignees")
        .select("booking_id, membership_id")
        .in("booking_id", chunk) as unknown as Promise<{
        data: Array<{ booking_id: string; membership_id: string }> | null;
        error: { message: string } | null;
      }>,
    ),
    // A claim is what matters, not the offer's own status: a 1-of-2 filled
    // offer still means one real person is showing up. !inner so the filter
    // limits the claims returned, rather than returning every claim with a
    // null offer for the ones that don't match.
    selectInChunks(ids, (chunk) =>
      db
        .from("job_offer_claims")
        .select(
          "contact_id, membership_id, offer:job_offers!inner ( booking_id )" as never,
        )
        .in("offer.booking_id" as never, chunk as never) as unknown as Promise<{
        data: Array<{
          contact_id: string | null;
          membership_id: string | null;
          offer: { booking_id: string } | null;
        }> | null;
        error: { message: string } | null;
      }>,
    ),
  ]);
  for (const [name, r] of [
    ["bookings", primary],
    ["booking_assignees", crew],
    ["job_offer_claims", offers],
  ] as const) {
    if (r.error) {
      console.error(`[booking-coverage] ${name} lookup failed:`, r.error.message);
    }
  }

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
    if (!c) continue;
    if (claim.contact_id && !c.freelancerContactIds.includes(claim.contact_id)) {
      c.freelancerContactIds.push(claim.contact_id);
    }
    // A roster subcontractor's claim is assignment (the claim action writes
    // assigned_to / booking_assignees too), so this is usually redundant —
    // but if that write ever lagged or failed, the claim alone must still
    // count as "someone is coming".
    if (claim.membership_id && !c.employeeIds.includes(claim.membership_id)) {
      c.employeeIds.push(claim.membership_id);
    }
  }

  // A deactivated member is NOT coverage. Without this, a disabled
  // employee still sitting on future jobs masked them as staffed — the
  // unassigned-booking alert stayed silent, and auto-complete could
  // invoice a client for work nobody was coming to do.
  const allEmployeeIds = Array.from(
    new Set([...out.values()].flatMap((c) => c.employeeIds)),
  );
  if (allEmployeeIds.length > 0) {
    const { data: activeRows } = await selectInChunks(allEmployeeIds, (chunk) =>
      db
        .from("memberships")
        .select("id")
        .in("id", chunk)
        .eq("status", "active") as unknown as Promise<{
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      }>,
    );
    const active = new Set((activeRows ?? []).map((r) => r.id));
    for (const c of out.values()) {
      c.employeeIds = c.employeeIds.filter((mid) => active.has(mid));
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

/**
 * Freelancer coverage as display names, per booking.
 *
 * Display code kept re-deriving this from job_offers.filled_contact_id, which
 * loses claimers two ways: a 1-of-N claim leaves the offer 'open' (filtered
 * out), and a later claim overwrites the single filled_* pointer. The claims
 * table is the record — read it, via the same admin client the coverage
 * resolver already needs (job_offer_claims RLS is owner/admin-only, but
 * managers legitimately see who's turning up). Callers must pass booking ids
 * that came from an org-scoped query.
 */
export async function resolveFreelancerCoverageNames(
  bookingIds: string[],
): Promise<Map<string, string[]>> {
  const coverage = await resolveBookingCoverage(bookingIds);
  const contactIds = Array.from(
    new Set([...coverage.values()].flatMap((c) => c.freelancerContactIds)),
  );
  const out = new Map<string, string[]>();
  if (contactIds.length === 0) return out;

  const db = createSupabaseAdminClient();
  const { data } = (await db
    .from("freelancer_contacts")
    .select("id, full_name")
    .in("id", contactIds)) as unknown as {
    data: Array<{ id: string; full_name: string | null }> | null;
  };
  const nameById = new Map<string, string>();
  for (const c of data ?? []) {
    if (c.full_name) nameById.set(c.id, c.full_name);
  }

  for (const [bookingId, c] of coverage) {
    const names = c.freelancerContactIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => Boolean(n));
    if (names.length > 0) out.set(bookingId, names);
  }
  return out;
}
