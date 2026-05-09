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

  const [{ data: booking, error }, options, { data: assignees }] =
    await Promise.all([
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
      // Additional crew members, excluding the primary. Primary is
      // already on booking.assigned_to so we don't double-count.
      supabase
        .from("booking_assignees" as never)
        .select("membership_id, is_primary")
        .eq("booking_id" as never, id as never) as unknown as Promise<{
        data: Array<{ membership_id: string; is_primary: boolean }> | null;
      }>,
    ]);

  if (error) throw error;
  if (!booking) notFound();

  const additional_assignees = (assignees ?? [])
    .filter((a) => !a.is_primary)
    .map((a) => a.membership_id);

  // Fetch the series row so the "Edit recurring schedule" section can be
  // pre-filled with the current rule. Only needed when this booking belongs
  // to a series.
  const seriesData = booking.series_id
    ? await (supabase
        .from("booking_series" as never)
        .select(
          "pattern, start_time, starts_at, ends_at, custom_days, monthly_nth, monthly_dow",
        )
        .eq("id" as never, booking.series_id as never)
        .maybeSingle() as unknown as Promise<{
        data: {
          pattern: string;
          /** PostgreSQL time: "HH:MM:SS" */
          start_time: string;
          starts_at: string;
          ends_at: string | null;
          custom_days: number[] | null;
          monthly_nth: number | null;
          monthly_dow: number | null;
        } | null;
      }>)
    : { data: null };

  const series = seriesData.data;

  // The "regenerate from" date defaults to this booking's date in org tz
  // (YYYY-MM-DD). The owner can push it forward if they want to leave
  // earlier occurrences untouched.
  const seriesStartsAtDefault = toDatetimeLocal(booking.scheduled_at, orgTz).slice(0, 10);

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
              additional_assignees,
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
              series_id: booking.series_id,
              scheduled_at_utc: booking.scheduled_at,
              // Series schedule — only present when booking is part of a series.
              ...(series
                ? {
                    series_pattern: series.pattern,
                    // PostgreSQL time columns come back as "HH:MM:SS" — slice to HH:MM.
                    series_start_time: series.start_time.slice(0, 5),
                    series_starts_at: seriesStartsAtDefault,
                    series_ends_at: series.ends_at ?? null,
                    series_custom_days: series.custom_days ?? [],
                    series_monthly_nth: series.monthly_nth,
                    series_monthly_dow: series.monthly_dow,
                  }
                : {}),
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
