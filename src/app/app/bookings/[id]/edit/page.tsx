import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { centsToDollarString, toDatetimeLocal } from "@/lib/validators/common";
import { BookingForm } from "../../booking-form";
import { fetchBookingFormOptions } from "../../options";
import { DeleteBookingForm } from "./delete-form";
import { MakeRecurringButton } from "../make-recurring-button";

export const metadata = { title: "Edit booking" };

export default async function EditBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ delete_error?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const { delete_error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const orgTz = await getOrgTimezone(membership.organization_id);

  const [{ data: booking, error }, options, { data: assignees }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, client_id, assigned_to, scheduled_at, duration_minutes, service_type, service_type_id, status, total_cents, hourly_rate_cents, address, notes, series_id, splits, divide_hours_evenly, is_free, property_id",
        )
        .eq("id", id)
        .maybeSingle() as unknown as Promise<{
        data: {
          id: string;
          client_id: string;
          assigned_to: string | null;
          scheduled_at: string;
          duration_minutes: number;
          service_type: string;
          service_type_id: string | null;
          status: string;
          total_cents: number;
          hourly_rate_cents: number | null;
          address: string | null;
          notes: string | null;
          series_id: string | null;
          splits: Array<{
            id: string;
            assigned_to: string;
            duration_minutes: number;
          }> | null;
          divide_hours_evenly: boolean | null;
          is_free: boolean | null;
          property_id: string | null;
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

  // People on this job who are not active any more. The crew picker only
  // draws active people, so one of these used to be on the job, invisible,
  // and un-removable, while the save refused because of her (Svit,
  // 2026-11-14: a series still naming a placeholder deactivated in May).
  //
  // On an upcoming job she can't do the work, so she is taken out of what
  // the form starts with and the form says so; saving makes it real. On a
  // job that has already happened she is left in and shown with her own
  // button, because taking someone off a finished job is for a person to
  // decide; the save still refuses until she is off (crew-eligibility.ts).
  const activeIds = new Set(options.employees.map((e) => e.id));
  const onJob = new Set<string>();
  if (booking.assigned_to) onJob.add(booking.assigned_to);
  for (const a of assignees ?? []) onJob.add(a.membership_id);
  for (const s of booking.splits ?? []) if (s.assigned_to) onJob.add(s.assigned_to);
  const formerIds = [...onJob].filter((mid) => !activeIds.has(mid));
  let formerCrew: Array<{ id: string; label: string }> = [];
  if (formerIds.length > 0) {
    const { data: gone } = (await supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .eq("organization_id", membership.organization_id)
      .in("id", formerIds)) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    const names = new Map((gone ?? []).map((m) => [m.id, memberDisplayName(m)]));
    formerCrew = formerIds.map((mid) => ({
      id: mid,
      label: names.get(mid) ?? "Someone who has left",
    }));
  }
  const stillToCome =
    // eslint-disable-next-line react-hooks/purity -- server component: renders once on the server, no hydration to drift
    new Date(booking.scheduled_at).getTime() > Date.now() &&
    !["completed", "cancelled"].includes(booking.status);
  // Not on a job with per-person times: older segments have no start of
  // their own and are timed one after another, so taking one out here would
  // move everyone after it. There the person is shown and taken off by
  // hand in the picker, which keeps each remaining person's own times.
  const hasSegments = (booking.splits ?? []).length > 0;
  const dropFormer = stillToCome && formerCrew.length > 0 && !hasSegments;
  const former = new Set(formerIds);
  const keep = (mid: string | null | undefined): mid is string =>
    !!mid && !(dropFormer && former.has(mid));

  const additional_assignees = (assignees ?? [])
    .filter((a) => !a.is_primary)
    .map((a) => a.membership_id)
    .filter(keep);

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
  const seriesStartsAtDefault = toDatetimeLocal(
    booking.scheduled_at,
    orgTz,
  ).slice(0, 10);

  return (
    <PageShell title="Edit booking">
      <div className="max-w-3xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <BookingForm
            mode="edit"
            id={booking.id}
            currency={currency}
            {...options}
            formerCrew={formerCrew}
            formerCrewDropped={dropFormer}
            defaults={{
              client_id: booking.client_id,
              assigned_to: keep(booking.assigned_to) ? booking.assigned_to : null,
              additional_assignees,
              scheduled_at_local: toDatetimeLocal(booking.scheduled_at, orgTz),
              duration_minutes: booking.duration_minutes,
              service_type: booking.service_type,
              service_type_id: booking.service_type_id,
              status: booking.status,
              total_dollars: centsToDollarString(booking.total_cents),
              address: booking.address,
              notes: booking.notes,
              // Without this, every save of this form wrote property_id =
              // null — the picker defaulted to "Choose…" and the server
              // treats empty as "no property", so an ordinary time change
              // silently severed the booking (and, via this-and-future,
              // the whole series) from its property.
              property_id: booking.property_id,
              series_id: booking.series_id,
              scheduled_at_utc: booking.scheduled_at,
              splits: (booking.splits ?? []).filter((s) => keep(s.assigned_to)),
              divide_hours_evenly: booking.divide_hours_evenly ?? false,
              is_free: booking.is_free ?? false,
              hourly_rate_cents: booking.hourly_rate_cents ?? 0,
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
        {!booking.series_id && booking.status !== "cancelled" && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-sm font-semibold">Make this recurring</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Turn this one-off into a recurring cleaning — this visit stays as
              the first, and future visits are scheduled automatically on the
              same day and time.
            </p>
            <div className="mt-4">
              <MakeRecurringButton bookingId={booking.id} />
            </div>
          </div>
        )}
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">
            Danger zone
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Hours logged on this job are kept in Timesheets (unlinked, and they
            can be re-attached). Reviews and invoices are preserved but lose
            their link to it.
          </p>
          {delete_error && (
            <p className="mt-3 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {delete_error}
            </p>
          )}
          <div className="mt-4">
            <DeleteBookingForm
              id={booking.id}
              seriesId={booking.series_id}
              scheduledAt={booking.scheduled_at}
              // eslint-disable-next-line react-hooks/purity -- server component: renders once on the server, no hydration to drift
              isPast={new Date(booking.scheduled_at).getTime() < Date.now()}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
