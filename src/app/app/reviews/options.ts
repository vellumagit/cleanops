import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchReviewFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [clients, employees, bookings] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("memberships")
      .select("id, profile:profiles ( full_name )")
      .eq("status", "active"),
    supabase
      .from("bookings")
      .select("id, scheduled_at, client:clients ( name )")
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(100),
  ]);

  return {
    clients: clients.data?.map((c) => ({ id: c.id, label: c.name })) ?? [],
    employees:
      employees.data?.map((m) => ({
        id: m.id,
        label: m.profile?.full_name ?? "Unnamed",
      })) ?? [],
    bookings:
      bookings.data?.map((b) => ({
        id: b.id,
        label: `${b.client?.name ?? "Client"} · ${new Date(
          b.scheduled_at,
        ).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`,
      })) ?? [],
  };
}
