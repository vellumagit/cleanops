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

  // Ask only about the bookings this picker will actually show. The first
  // cut fetched "every live invoice, limit 1000, no order" and built the
  // map from that: once an org crossed 1000 live booking-linked invoices
  // the rows returned were arbitrary, so an already-billed booking could
  // come back unmarked and the owner met the raw Postgres unique-constraint
  // error this map exists to prevent.
  //
  // CHUNKED AT 200, the same bound google-calendar.ts uses, because an
  // in-list of 500 uuids is an ~18KB query string — past the usual 8KB
  // request-line limit, where the request fails outright and the map comes
  // back empty. An empty map is the same silent lie as a truncated one.
  const bookingIds = (bookings ?? []).map((b) => b.id);
  const invoiceByBooking = new Map<string, string>();
  for (let i = 0; i < bookingIds.length; i += 200) {
    const chunk = bookingIds.slice(i, i + 200);
    const { data, error } = (await supabase
      .from("invoices")
      .select("id, booking_id")
      .in("booking_id", chunk)
      .is("voided_at" as never, null as never)) as unknown as {
      data: Array<{ id: string; booking_id: string | null }> | null;
      error: { message: string } | null;
    };
    // A failed lookup must not read as "nothing is billed" — say so, and
    // let the DB constraint be the backstop rather than the surprise.
    if (error) {
      console.error("[invoice-options] billed-booking lookup failed:", error.message);
      continue;
    }
    for (const inv of data ?? []) {
      if (inv.booking_id) invoiceByBooking.set(inv.booking_id, inv.id);
    }
  }

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
