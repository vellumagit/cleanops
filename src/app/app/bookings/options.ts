import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

/** Fetch the option lists every booking form needs (clients/packages/employees). */
export async function fetchBookingFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [clients, packages, employees] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("packages")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    // Every active membership is assignable — owners, admins, and shadow
    // (manually-added) members included.
    supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .eq("status", "active"),
  ]);

  return {
    clients:
      clients.data?.map((c) => ({ id: c.id, label: c.name })) ?? [],
    packages:
      packages.data?.map((p) => ({ id: p.id, label: p.name })) ?? [],
    employees:
      employees.data?.map((m) => ({
        id: m.id,
        label: memberDisplayName(m),
      })) ?? [],
  };
}
