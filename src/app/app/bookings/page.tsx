import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { BookingsTable, type BookingRow } from "./bookings-table";

export const metadata = { title: "Bookings" };

export default async function BookingsPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin" || membership.role === "manager";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await (supabase
    .from("bookings")
    .select(
      `
        id,
        scheduled_at,
        duration_minutes,
        service_type,
        status,
        total_cents,
        series_id,
        client:clients ( id, name ),
        assigned:memberships!bookings_assigned_to_fkey (
          id,
          profile:profiles ( full_name )
        )
      `,
    )
    .order("scheduled_at", { ascending: false })
    .limit(200) as unknown as Promise<{
    data: Array<{
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      status: string;
      total_cents: number;
      series_id: string | null;
      client: { id: string; name: string } | null;
      assigned: { id: string; profile: { full_name: string } | null } | null;
    }> | null;
    error: { message: string } | null;
  }>);

  if (error) throw error;

  const rows: BookingRow[] = (data ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    duration_minutes: b.duration_minutes,
    service_type: b.service_type,
    status: b.status as BookingRow["status"],
    total_cents: b.total_cents,
    client_name: b.client?.name ?? "—",
    assigned_name: b.assigned?.profile?.full_name ?? null,
    series_id: b.series_id ?? null,
  }));

  // Count active series for this org
  const { count: seriesCount } = await (supabase
    .from("booking_series" as never)
    .select("id", { count: "exact", head: true })
    .eq("active" as never, true as never) as unknown as Promise<{
    count: number | null;
  }>);

  return (
    <PageShell
      title="Bookings"
      description="All cleaning jobs scheduled across your team."
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            {(seriesCount ?? 0) > 0 && (
              <Link
                href="/app/bookings/series"
                className={buttonVariants({ variant: "outline" })}
              >
                <Repeat className="h-4 w-4" />
                Series ({seriesCount})
              </Link>
            )}
            <Link
              href="/app/bookings/new"
              className={buttonVariants({ variant: "default" })}
            >
              <Plus className="h-4 w-4" />
              New booking
            </Link>
          </div>
        ) : null
      }
    >
      <BookingsTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
