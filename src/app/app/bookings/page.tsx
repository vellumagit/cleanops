import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { BookingsTable, type BookingRow } from "./bookings-table";

export const metadata = { title: "Bookings" };

export default async function BookingsPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `
        id,
        scheduled_at,
        duration_minutes,
        service_type,
        status,
        total_cents,
        client:clients ( id, name ),
        assigned:memberships!bookings_assigned_to_fkey (
          id,
          profile:profiles ( full_name )
        )
      `,
    )
    .order("scheduled_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows: BookingRow[] = (data ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    duration_minutes: b.duration_minutes,
    service_type: b.service_type,
    status: b.status,
    total_cents: b.total_cents,
    client_name: b.client?.name ?? "—",
    assigned_name: b.assigned?.profile?.full_name ?? null,
  }));

  return (
    <PageShell
      title="Bookings"
      description="All cleaning jobs scheduled across your team."
      actions={
        canEdit ? (
          <Link
            href="/app/bookings/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New booking
          </Link>
        ) : null
      }
    >
      <BookingsTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
