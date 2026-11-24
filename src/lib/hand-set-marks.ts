import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * A person set this one visit's crew: a later "this and all future" save
 * asks before overriding it (series-hand-set.ts, migration 20261124040000).
 *
 * Written by the three places one visit's crew is set on its own: the
 * booking form and Change crew with "just this booking", and a drag onto
 * another cleaner on the board. Only a visit that belongs to a series is
 * marked. Never fails the save that calls it.
 */
export async function markCrewSetByHand(organizationId: string, bookingId: string): Promise<void> {
  try {
    const { error } = await createSupabaseAdminClient()
      .from("bookings")
      .update({ crew_set_by_hand_at: new Date().toISOString() } as never)
      .eq("id", bookingId)
      .eq("organization_id", organizationId)
      .not("series_id" as never, "is", null);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[series] could not mark this visit's crew as set by hand:", err);
  }
}
