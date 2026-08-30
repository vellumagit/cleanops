import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SeriesTable, type SeriesRow } from "./series-table";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Recurring bookings" };

export default async function SeriesPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const tz = await getOrgTimezone(membership.organization_id);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await (supabase
    .from("booking_series" as never)
    .select(
      `
        id,
        pattern,
        custom_days,
        start_time,
        starts_at,
        ends_at,
        active,
        duration_minutes,
        service_type,
        total_cents,
        assigned_to,
        created_at,
        client_id,
        client:clients ( name )
      `,
    )
    // Explicit org scope — a two-org admin reads both orgs via RLS alone.
    .eq("organization_id" as never, membership.organization_id as never)
    .order("created_at", { ascending: false })
    .limit(100) as unknown as Promise<{
    data: Array<{
      id: string;
      pattern: string;
      custom_days: number[] | null;
      start_time: string;
      starts_at: string;
      ends_at: string | null;
      active: boolean;
      duration_minutes: number;
      service_type: string;
      total_cents: number;
      assigned_to: string | null;
      created_at: string;
      client_id: string | null;
      client: { name: string } | null;
    }> | null;
    error: { message: string } | null;
  }>);

  if (error) throw error;

  // Get booking counts per series
  const seriesIds = (data ?? []).map((s) => s.id);
  const bookingCounts: Record<
    string,
    { total: number; upcoming: number; unbilled: number }
  > = {};

  if (seriesIds.length > 0) {
    const now = new Date().toISOString();

    // Total bookings per series
    const { data: totalData } = await (supabase
      .from("bookings")
      .select("series_id")
      .in("series_id" as never, seriesIds as never) as unknown as Promise<{
      data: Array<{ series_id: string }> | null;
    }>);

    // Upcoming bookings per series
    const { data: upcomingData } = await (supabase
      .from("bookings")
      .select("series_id")
      .in("series_id" as never, seriesIds as never)
      .gte("scheduled_at" as never, now as never)
      .in(
        "status" as never,
        ["pending", "confirmed"] as never,
      ) as unknown as Promise<{
      data: Array<{ series_id: string }> | null;
    }>);

    // Past COMPLETED occurrences no invoice has claimed — the money the
    // series has earned that nothing has billed yet. Surfacing it here is
    // the difference between "the cron will get it" and finding out at
    // month-end that it never did.
    const { data: unbilledData } = await (supabase
      .from("bookings")
      .select("series_id")
      .in("series_id" as never, seriesIds as never)
      .eq("status" as never, "completed" as never)
      .is("billing_invoice_id" as never, null as never)
      .lt("scheduled_at" as never, now as never) as unknown as Promise<{
      data: Array<{ series_id: string }> | null;
    }>);

    for (const id of seriesIds) {
      bookingCounts[id] = {
        total: (totalData ?? []).filter((b) => b.series_id === id).length,
        upcoming: (upcomingData ?? []).filter((b) => b.series_id === id).length,
        unbilled: (unbilledData ?? []).filter((b) => b.series_id === id)
          .length,
      };
    }
  }

  const rows: SeriesRow[] = (data ?? []).map((s) => ({
    id: s.id,
    pattern: s.pattern,
    custom_days: s.custom_days,
    start_time: s.start_time,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    active: s.active,
    duration_minutes: s.duration_minutes,
    service_type: s.service_type,
    total_cents: s.total_cents,
    created_at: s.created_at,
    client_name: s.client?.name ?? "—",
    client_id: s.client_id ?? null,
    total_bookings: bookingCounts[s.id]?.total ?? 0,
    upcoming_bookings: bookingCounts[s.id]?.upcoming ?? 0,
    unbilled_past: bookingCounts[s.id]?.unbilled ?? 0,
  }));

  return (
    <PageShell
      title="Recurring bookings"
      description="Manage your recurring booking schedules."
      actions={
        <Link
          href="/app/bookings"
          className={buttonVariants({ variant: "outline" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to bookings
        </Link>
      }
    >
      <SeriesTable tz={tz} rows={rows} />
    </PageShell>
  );
}
