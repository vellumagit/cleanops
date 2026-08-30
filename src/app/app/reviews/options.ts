import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";

export async function fetchReviewFormOptions(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const [tz, [clients, employees, bookings]] = await Promise.all([
    getOrgTimezone(organizationId),
    Promise.all([
      // Explicit org scope on all three — a two-org admin reads both orgs
      // via RLS alone.
      supabase
        .from("clients")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name"),
      supabase
        .from("memberships")
        .select("id, display_name, profile:profiles ( full_name )")
        .eq("organization_id", organizationId)
        .eq("status", "active"),
      supabase
        .from("bookings")
        // client_id + assigned_to ride along so picking the booking can
        // fill the other two dropdowns — it fully determines them.
        .select("id, scheduled_at, client_id, assigned_to, client:clients ( name )")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .order("scheduled_at", { ascending: false })
        .limit(100),
    ]),
  ]);

  return {
    clients: clients.data?.map((c) => ({ id: c.id, label: c.name })) ?? [],
    employees:
      (employees.data?.map((m) => ({
        id: m.id,
        label: memberDisplayName(m),
      })) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
    bookings:
      bookings.data?.map((b) => ({
        id: b.id,
        client_id: b.client_id ?? null,
        assigned_to: b.assigned_to ?? null,
        label: `${b.client?.name ?? "Client"} · ${new Date(
          b.scheduled_at,
        ).toLocaleDateString("en-US", {
          // Org wall-clock, not the server's UTC — an evening job used to
          // label as the next day.
          timeZone: tz,
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`,
      })) ?? [],
  };
}
