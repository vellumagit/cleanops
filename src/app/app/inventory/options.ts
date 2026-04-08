import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchInventoryFormOptions() {
  const supabase = await createSupabaseServerClient();
  const { data: members } = await supabase
    .from("memberships")
    .select("id, status, profile:profiles ( full_name )")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return {
    members: (members ?? []).map((m) => ({
      id: m.id,
      label: m.profile?.full_name ?? "Unnamed member",
    })),
  };
}
