import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchInvoiceFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [{ data: clients }, { data: bookings }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, service_type, client:clients ( name )",
      )
      .order("scheduled_at", { ascending: false })
      .limit(200),
  ]);

  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, label: c.name })),
    bookings: (bookings ?? []).map((b) => ({
      id: b.id,
      label: `${b.client?.name ?? "—"} · ${new Date(
        b.scheduled_at,
      ).toLocaleDateString()}`,
    })),
  };
}
