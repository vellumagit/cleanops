import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

export type MemberOption = { id: string; label: string };

/**
 * Fetch active members for the "Assign to" dropdown in the task form.
 */
export async function fetchTaskMemberOptions(): Promise<MemberOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? [])
    .map((m) => ({
      id: m.id,
      label: memberDisplayName(m),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
