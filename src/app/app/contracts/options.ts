import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchContractFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [{ data: clients }, { data: estimates }, { data: services }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, name")
        .is("archived_at" as never, null as never)
        .order("name"),
      supabase
        .from("estimates")
        .select("id, total_cents, service_description, client:clients ( name )")
        .order("created_at", { ascending: false })
        .limit(100),
      // Contracts only show CLEANING-category services. Appointments
      // (meeting/walkthrough/etc.) don't make sense on a recurring
      // contract retainer, so filter to the four cleaning categories.
      supabase
        .from("service_types" as never)
        .select("id, name, category, sort_order")
        .eq("is_active" as never, true as never)
        .in("category" as never, ["standard", "deep", "move_out", "recurring"] as never)
        .order("sort_order" as never, { ascending: true } as never)
        .order("name" as never, { ascending: true } as never) as unknown as Promise<{
        data: Array<{
          id: string;
          name: string;
          category: string;
          sort_order: number;
        }> | null;
      }>,
    ]);

  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, label: c.name })),
    estimates: (estimates ?? []).map((e) => ({
      id: e.id,
      label: `${e.client?.name ?? "—"} · ${
        e.service_description ?? "Estimate"
      }`,
    })),
    services: (services ?? []).map((s) => ({
      id: s.id,
      label: s.name,
      category: s.category,
    })),
  };
}
