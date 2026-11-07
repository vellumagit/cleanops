import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveBilledBookingsChunked } from "@/lib/billed-bookings";

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

  // Ask only about the bookings this picker will actually show, and ask all
  // three ways a job can be billed (billed-bookings.ts): a direct invoice,
  // a line on a consolidated invoice, or the booking's own stamp. The
  // picker used to ask only the first, so a job already on a monthly
  // invoice was offered for a second invoice of its own, and the unique
  // index — which covers direct invoices only — let it through.
  //
  // Chunked at 200 because 500 uuids in a query string is past the usual
  // 8 KB request line. A failed lookup throws rather than reading as
  // "nothing is billed"; the page errors instead of offering a double bill.
  const bookingIds = (bookings ?? []).map((b) => b.id);
  const billedBy = await resolveBilledBookingsChunked(supabase, bookingIds);
  const invoiceByBooking = new Map<string, string>();
  for (const [bookingId, inv] of billedBy) invoiceByBooking.set(bookingId, inv.id);

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
