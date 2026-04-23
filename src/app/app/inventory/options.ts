import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

export async function fetchInventoryFormOptions() {
  const supabase = await createSupabaseServerClient();
  const { data: members } = await supabase
    .from("memberships")
    // display_name covers shadow members (manually-added, no linked
    // profile) so they show up in the assignee picker with their
    // real name instead of "Unnamed member".
    .select("id, status, display_name, profile:profiles ( full_name )")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return {
    members: (members ?? []).map((m) => ({
      id: m.id,
      label: memberDisplayName(m),
    })),
  };
}
