import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

/**
 * Fetch the option lists every booking form needs (clients / packages /
 * employees), plus enough metadata on each client and package to auto-fill
 * the booking form when one is selected. Pre-fill rules are handled by
 * the form itself — here we just ship the data.
 */
export type ServiceOption = {
  id: string;
  label: string;
  category: string;
  description: string | null;
  default_duration_minutes: number | null;
  default_price_cents: number | null;
  color: string | null;
  sort_order: number;
};

export async function fetchBookingFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [clients, packages, employees, services] = await Promise.all([
    // preferred_cleaner_id lets the form auto-fill the primary
    // assignee when a client is picked — one fewer click when the
    // client always wants the same cleaner. Column isn't in generated
    // types yet; cast the select result.
    supabase
      .from("clients")
      .select("id, name, address, notes, preferred_cleaner_id")
      // Archived clients shouldn't appear in the booking form dropdown —
      // owners archive a client to stop scheduling new work for them
      // while keeping the historical record. Same filter applied to the
      // billing-cycle cron and the clients list page.
      .is("archived_at" as never, null as never)
      .order("name") as unknown as Promise<{
      data:
        | Array<{
            id: string;
            name: string;
            address: string | null;
            notes: string | null;
            preferred_cleaner_id: string | null;
          }>
        | null;
    }>,
    supabase
      .from("packages")
      .select("id, name, price_cents, duration_minutes")
      .eq("is_active", true)
      .order("name"),
    // Every active membership is assignable — owners, admins, and shadow
    // (manually-added) members included. pay_rate_cents is used to
    // pre-fill split-shift hourly rates.
    supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name ), pay_rate_cents")
      .eq("status", "active") as unknown as Promise<{
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
        pay_rate_cents: number | null;
      }> | null;
    }>,
    // Active service catalog for this org. RLS scopes by membership so we
    // don't need an explicit organization_id filter.
    supabase
      .from("service_types" as never)
      .select(
        "id, category, name, description, default_duration_minutes, default_price_cents, color, sort_order",
      )
      .eq("is_active" as never, true as never)
      .order("sort_order" as never, { ascending: true } as never)
      .order("name" as never, { ascending: true } as never) as unknown as Promise<{
      data: Array<{
        id: string;
        category: string;
        name: string;
        description: string | null;
        default_duration_minutes: number | null;
        default_price_cents: number | null;
        color: string | null;
        sort_order: number;
      }> | null;
    }>,
  ]);

  return {
    clients:
      clients.data?.map((c) => ({
        id: c.id,
        label: c.name,
        address: c.address ?? null,
        notes: c.notes ?? null,
        preferred_cleaner_id: c.preferred_cleaner_id ?? null,
      })) ?? [],
    packages:
      packages.data?.map((p) => ({
        id: p.id,
        label: p.name,
        price_cents: p.price_cents,
        duration_minutes: p.duration_minutes,
      })) ?? [],
    employees:
      (employees.data?.map((m) => ({
        id: m.id,
        label: memberDisplayName(m),
        pay_rate_cents: m.pay_rate_cents ?? null,
      })) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
    services:
      (services.data ?? []).map((s) => ({
        id: s.id,
        label: s.name,
        category: s.category,
        description: s.description,
        default_duration_minutes: s.default_duration_minutes,
        default_price_cents: s.default_price_cents,
        color: s.color,
        sort_order: s.sort_order,
      })) as ServiceOption[],
  };
}
