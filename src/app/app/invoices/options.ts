import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BookingOption = {
  id: string;
  client_id: string;
  client_name: string;
  service_type: string;
  scheduled_at: string;
  status: string;
  total_cents: number;
  /** The live (non-void) invoice already billing this booking, if any.
   *  One live invoice per booking is a DB constraint — the picker shows
   *  it so nobody discovers the rule as a Postgres error. */
  invoiced_by: string | null;
};

export async function fetchInvoiceFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [{ data: clients }, { data: bookings }, { data: liveInvoices }] =
    await Promise.all([
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
      supabase
        .from("invoices")
        .select("id, booking_id")
        .not("booking_id", "is", null)
        .is("voided_at" as never, null as never)
        .limit(1000) as unknown as Promise<{
        data: Array<{ id: string; booking_id: string | null }> | null;
      }>,
    ]);

  const invoiceByBooking = new Map(
    (liveInvoices ?? [])
      .filter((i) => i.booking_id)
      .map((i) => [i.booking_id as string, i.id]),
  );

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
      invoiced_by: invoiceByBooking.get(b.id) ?? null,
    })) as BookingOption[],
  };
}
