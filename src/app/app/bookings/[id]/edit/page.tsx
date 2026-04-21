import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { PageShell } from "@/components/page-shell";
import {
  centsToDollarString,
  toDatetimeLocal,
} from "@/lib/validators/common";
import { BookingForm } from "../../booking-form";
import { fetchBookingFormOptions } from "../../options";
import { DeleteBookingForm } from "./delete-form";

export const metadata = { title: "Edit booking" };

export default async function EditBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const orgTz = await getOrgTimezone(membership.organization_id);

  const [{ data: booking, error }, options] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, client_id, package_id, assigned_to, scheduled_at, duration_minutes, service_type, status, total_cents, hourly_rate_cents, address, notes, series_id",
      )
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{
      data: {
        id: string;
        client_id: string;
        package_id: string | null;
        assigned_to: string | null;
        scheduled_at: string;
        duration_minutes: number;
        service_type: string;
        status: string;
        total_cents: number;
        hourly_rate_cents: number | null;
        address: string | null;
        notes: string | null;
        series_id: string | null;
      } | null;
      error: { message: string } | null;
    }>,
    fetchBookingFormOptions(),
  ]);

  if (error) throw error;
  if (!booking) notFound();

  return (
    <PageShell title="Edit booking">
      <div className="max-w-3xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <BookingForm
            mode="edit"
            id={booking.id}
            currency={currency}
            {...options}
            defaults={{
              client_id: booking.client_id,
              package_id: booking.package_id,
              assigned_to: booking.assigned_to,
              scheduled_at_local: toDatetimeLocal(booking.scheduled_at, orgTz),
              duration_minutes: booking.duration_minutes,
              service_type: booking.service_type,
              status: booking.status,
              total_dollars: centsToDollarString(booking.total_cents),
              hourly_rate_dollars: centsToDollarString(
                booking.hourly_rate_cents,
              ),
              address: booking.address,
              notes: booking.notes,
            }}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will also remove related time entries. Reviews and
            invoices will be unlinked but preserved.
          </p>
          <div className="mt-4">
            <DeleteBookingForm
              id={booking.id}
              seriesId={booking.series_id}
              scheduledAt={booking.scheduled_at}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
