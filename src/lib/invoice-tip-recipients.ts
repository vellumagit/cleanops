import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveShiftWindows, shiftWindowKey } from "@/lib/crew-hours";
import { memberDisplayName } from "@/lib/member-display";
import type { TipShare } from "@/lib/tip-split";

/**
 * Who a tip on this invoice is actually for.
 *
 * Reads with the ADMIN client on purpose: the public invoice page has no
 * signed-in user — the payer is the cleaning company's customer — so this has
 * to work outside RLS. It returns nothing but names and minutes; no rates, no
 * pay, nothing a client shouldn't see on a page they can open with a link.
 */

export type TipRecipient = {
  membershipId: string;
  name: string;
  /** Minutes credited to this person across every job on the invoice. */
  minutes: number;
};

export type InvoiceTipRecipients = {
  recipients: TipRecipient[];
  /**
   * Set when exactly one person did every job on the invoice — which, at 95%
   * recurring, is the common case. This is what lets the page say "Add a tip
   * for Olha" instead of the vaguer team wording.
   */
  soleRecipient: TipRecipient | null;
};

const EMPTY: InvoiceTipRecipients = { recipients: [], soleRecipient: null };

export async function resolveInvoiceTipRecipients(
  invoiceId: string,
): Promise<InvoiceTipRecipients> {
  try {
    const db = createSupabaseAdminClient();

    // Line items carry booking_id — the link that broke on the Khual invoice
    // and got fixed in 22e71c9. A line with no booking (a manual charge) can't
    // be credited to anyone and is simply skipped.
    const { data: lines } = (await db
      .from("invoice_line_items" as never)
      .select("booking_id")
      .eq("invoice_id" as never, invoiceId as never)) as unknown as {
      data: Array<{ booking_id: string | null }> | null;
    };

    const bookingIds = Array.from(
      new Set((lines ?? []).map((l) => l.booking_id).filter(Boolean)),
    ) as string[];
    if (bookingIds.length === 0) return EMPTY;

    const [bookingsRes, crewRes] = await Promise.all([
      db
        .from("bookings")
        .select("id, duration_minutes, assigned_to")
        .in("id", bookingIds) as unknown as Promise<{
        data: Array<{
          id: string;
          duration_minutes: number | null;
          assigned_to: string | null;
        }> | null;
      }>,
      db
        .from("booking_assignees")
        .select("booking_id, membership_id")
        .in("booking_id", bookingIds) as unknown as Promise<{
        data: Array<{ booking_id: string; membership_id: string }> | null;
      }>,
    ]);

    const bookings = bookingsRes.data ?? [];
    if (bookings.length === 0) return EMPTY;

    // UNION of both sources, not either one.
    //
    // assignBookingCrewAction writes the primary to bookings.assigned_to and
    // the rest to booking_assignees, and in this org's live data the primary
    // usually appears in BOTH — but not always (2 of 200 bookings checked had
    // a primary with no crew row). Reading only booking_assignees would drop
    // the one cleaner who did the whole job; reading only assigned_to would
    // drop everyone who helped. So: union, deduped per booking.
    const crewByBooking = new Map<string, Set<string>>();
    for (const b of bookings) {
      crewByBooking.set(
        b.id,
        new Set(b.assigned_to ? [b.assigned_to] : []),
      );
    }
    for (const row of crewRes.data ?? []) {
      const set = crewByBooking.get(row.booking_id);
      if (set) set.add(row.membership_id);
    }

    // Same source of truth the timesheets and field app use, so a tip is split
    // on the same minutes a cleaner is paid for — including split shifts,
    // where two people on one 4-hour job may have worked 3 and 1.
    const windows = await resolveShiftWindows(
      bookings.map((b) => ({ id: b.id, duration_minutes: b.duration_minutes })),
    );

    const minutesByMember = new Map<string, number>();
    for (const b of bookings) {
      const full = b.duration_minutes ?? 0;
      for (const membershipId of crewByBooking.get(b.id) ?? []) {
        // No window row means this person isn't in booking_assignees (the
        // lone-primary case) — they worked the whole job.
        const allotted =
          windows.get(shiftWindowKey(b.id, membershipId))?.allottedMinutes ??
          full;
        if (allotted <= 0) continue;
        minutesByMember.set(
          membershipId,
          (minutesByMember.get(membershipId) ?? 0) + allotted,
        );
      }
    }

    if (minutesByMember.size === 0) return EMPTY;

    const { data: members } = (await db
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .in("id", [...minutesByMember.keys()])) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };

    const nameById = new Map(
      (members ?? []).map((m) => [m.id, memberDisplayName(m)]),
    );

    const recipients: TipRecipient[] = [...minutesByMember.entries()]
      .map(([membershipId, minutes]) => ({
        membershipId,
        name: nameById.get(membershipId) ?? "Unknown",
        minutes,
      }))
      // Most-worked first, then by name so the order is stable between renders.
      .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

    return {
      recipients,
      soleRecipient: recipients.length === 1 ? recipients[0] : null,
    };
  } catch (err) {
    // A tip prompt is a nice-to-have on a page whose actual job is collecting
    // an invoice. If attribution falls over, the payer should still be able to
    // pay — they just won't be offered a tip.
    console.error("[tips] resolveInvoiceTipRecipients failed:", err);
    return EMPTY;
  }
}

/** The shape splitTipByMinutes wants. */
export function toTipShares(
  recipients: readonly TipRecipient[],
): TipShare[] {
  return recipients.map((r) => ({
    membershipId: r.membershipId,
    minutes: r.minutes,
  }));
}
