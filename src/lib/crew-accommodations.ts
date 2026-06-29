import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Of the given membership ids, return the set that has a non-empty
 * accommodation / health note on file (membership_admin_data.accommodations).
 *
 * Deliberately returns ONLY the ids — never the note text — so crew pickers can
 * show a discreet "has accommodations" flag to whoever is assigning a job while
 * the sensitive detail stays on the owner/admin-only employee file. Uses the
 * admin client so managers (who can assign but can't read the admin-data table
 * under RLS) still get the flag.
 *
 * Best-effort: if the admin-data table is unavailable (e.g. migration not yet
 * applied), returns an empty set so the picker still renders.
 */
export async function getFlaggedCrewIds(
  membershipIds: string[],
): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (membershipIds.length === 0) return flagged;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("membership_admin_data" as never)
      .select("membership_id, accommodations")
      .in("membership_id" as never, membershipIds as never)
      .not("accommodations" as never, "is" as never, null as never)) as unknown as {
      data: Array<{
        membership_id: string;
        accommodations: string | null;
      }> | null;
    };
    for (const r of data ?? []) {
      if (r.accommodations && r.accommodations.trim()) {
        flagged.add(r.membership_id);
      }
    }
  } catch {
    // Table missing / transient error — fall back to no flags.
  }
  return flagged;
}
