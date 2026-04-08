import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchContractFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [{ data: clients }, { data: estimates }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("estimates")
      .select("id, total_cents, service_description, client:clients ( name )")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, label: c.name })),
    estimates: (estimates ?? []).map((e) => ({
      id: e.id,
      label: `${e.client?.name ?? "—"} · ${
        e.service_description ?? "Estimate"
      }`,
    })),
  };
}
