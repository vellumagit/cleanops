import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

export type CleanerOption = { id: string; label: string };

/**
 * Fetch the active membership list for the client form's "preferred
 * cleaner" dropdown. Same fallback chain as everywhere else
 * (display_name → profile.full_name → "Unknown") so shadow members
 * and invited members look identical in the picker.
 */
export async function fetchClientFormCleaners(): Promise<CleanerOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select(
      "id, display_name, profile:profiles ( full_name )",
    )
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? [])
    .map((m) => ({
      id: m.id,
      label: memberDisplayName(m),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
