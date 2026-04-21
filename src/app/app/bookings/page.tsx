import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { BookingsTable, type BookingRow } from "./bookings-table";

export const metadata = { title: "Bookings" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin" || membership.role === "manager";
  const supabase = await createSupabaseServerClient();
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  let query = supabase
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
        address,
        client:clients ( id, name ),
        assigned:memberships!bookings_assigned_to_fkey (
          id,
          profile:profiles ( full_name )
        )
      `,
    );

  // Default: hide auto-archived rows. When ?archived=1, show ONLY archived.
  query = showArchived
    ? query.not("archived_at" as never, "is" as never, null as never)
    : query.is("archived_at" as never, null as never);

  const { data, error } = await (query
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
      address: string | null;
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
    address: b.address ?? null,
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
      title={showArchived ? "Bookings — archived" : "Bookings"}
      description={
        showArchived
          ? "Jobs older than your archive threshold. Read-only snapshot."
          : "All cleaning jobs scheduled across your team."
      }
      actions={
        <div className="flex items-center gap-2">
          <ArchivedToggle
            basePath="/app/bookings"
            showingArchived={showArchived}
          />
          {canEdit && !showArchived && (
            <>
              {(seriesCount ?? 0) > 0 && (
                <Link
                  href="/app/bookings/series"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Repeat className="h-4 w-4" />
                  Recurring ({seriesCount})
                </Link>
              )}
              <Link
                href="/app/bookings/new"
                className={buttonVariants({ variant: "default" })}
              >
                <Plus className="h-4 w-4" />
                New booking
              </Link>
            </>
          )}
        </div>
      }
    >
      <BookingsTable rows={rows} canEdit={canEdit && !showArchived} />
    </PageShell>
  );
}
