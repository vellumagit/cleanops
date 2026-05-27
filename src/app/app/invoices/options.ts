import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BookingOption = {
  id: string;
  client_id: string;
  client_name: string;
  service_type: string;
  scheduled_at: string;
  status: string;
  total_cents: number;
};

export async function fetchInvoiceFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [{ data: clients }, { data: bookings }] = await Promise.all([
    // Archived clients are excluded — owners shouldn't be able to
     // create new invoices for clients they've archived. (Existing
     // invoices for archived clients are still visible / payable.)
     supabase
      .from("clients")
      .select("id, name")
      .is("archived_at" as never, null as never)
      .order("name"),
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, service_type, status, total_cents, client:clients ( id, name )",
      )
      .order("scheduled_at", { ascending: false })
      .limit(500),
  ]);

  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, label: c.name })),
    bookings: (bookings ?? []).map((b) => ({
      id: b.id,
      client_id: (b.client as { id: string; name: string } | null)?.id ?? "",
      client_name: (b.client as { id: string; name: string } | null)?.name ?? "—",
      service_type: b.service_type ?? "",
      scheduled_at: b.scheduled_at,
      status: b.status ?? "",
      total_cents: b.total_cents ?? 0,
    })) as BookingOption[],
  };
}
