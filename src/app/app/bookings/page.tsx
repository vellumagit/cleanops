import Link from "next/link";
import { Plus, Repeat, Inbox } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";
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
  const tz = await getOrgTimezone(membership.organization_id);
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
        assigned_to,
        client:clients ( id, name ),
        assigned:memberships!bookings_assigned_to_fkey (
          id,
          display_name,
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
      assigned_to: string | null;
      client: { id: string; name: string } | null;
      assigned: {
        id: string;
        display_name: string | null;
        profile: { full_name: string } | null;
      } | null;
    }> | null;
    error: { message: string } | null;
  }>);

  if (error) throw error;

  // Active employees for the org — feeds the per-row "Assign" popup so
  // owners can change the crew without leaving the bookings list. RLS
  // already scopes memberships to the current org, so no explicit
  // org_id filter is needed.
  const { data: employeesData } = (await supabase
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .eq("status", "active")
    .in("role", ["employee", "admin", "owner"])
    .order("display_name", { ascending: true })) as unknown as {
    data: Array<{
      id: string;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  };
  const employees = (employeesData ?? []).map((m) => ({
    id: m.id,
    label: memberDisplayName(m) ?? "Unnamed",
  }));

  // Junction rows for the bookings on this page — gives us each
  // booking's full additional crew so the Assign dialog opens with the
  // current selection pre-filled. Single batch query keyed on the
  // bookings.id list keeps this cheap (one round trip, not N).
  const bookingIds = (data ?? []).map((b) => b.id);
  const { data: assigneesData } = bookingIds.length
    ? ((await supabase
        .from("booking_assignees" as never)
        .select("booking_id, membership_id, is_primary")
        .in("booking_id" as never, bookingIds as never)) as unknown as {
        data: Array<{
          booking_id: string;
          membership_id: string;
          is_primary: boolean;
        }> | null;
      })
    : { data: [] as Array<{ booking_id: string; membership_id: string; is_primary: boolean }> };
  const additionalByBooking = new Map<string, string[]>();
  for (const r of assigneesData ?? []) {
    if (r.is_primary) continue;
    const arr = additionalByBooking.get(r.booking_id) ?? [];
    arr.push(r.membership_id);
    additionalByBooking.set(r.booking_id, arr);
  }

  const rows: BookingRow[] = (data ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    duration_minutes: b.duration_minutes,
    service_type: b.service_type,
    status: b.status as BookingRow["status"],
    total_cents: b.total_cents,
    client_name: b.client?.name ?? "—",
    assigned_name: b.assigned ? memberDisplayName(b.assigned) : null,
    assigned_to: b.assigned_to,
    additional_assignee_ids: additionalByBooking.get(b.id) ?? [],
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

  // Pending client-submitted booking requests from the portal — surface
  // the count so the owner notices without having to navigate deeper.
  const { count: pendingRequestCount } = await (supabase
    .from("booking_requests" as never)
    .select("id", { count: "exact", head: true })
    .eq("status" as never, "pending" as never) as unknown as Promise<{
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
              {(pendingRequestCount ?? 0) > 0 && (
                <Link
                  href="/app/bookings/requests"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Inbox className="h-4 w-4" />
                  Requests ({pendingRequestCount})
                </Link>
              )}
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
      <BookingsTable
        rows={rows}
        canEdit={canEdit && !showArchived}
        tz={tz}
        employees={employees}
      />
    </PageShell>
  );
}
