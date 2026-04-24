import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

/**
 * Fetch the option lists every booking form needs (clients / packages /
 * employees), plus enough metadata on each client and package to auto-fill
 * the booking form when one is selected. Pre-fill rules are handled by
 * the form itself — here we just ship the data.
 */
export async function fetchBookingFormOptions() {
  const supabase = await createSupabaseServerClient();
  const [clients, packages, employees] = await Promise.all([
    // preferred_cleaner_id lets the form auto-fill the primary
    // assignee when a client is picked — one fewer click when the
    // client always wants the same cleaner. Column isn't in generated
    // types yet; cast the select result.
    supabase
      .from("clients")
      .select("id, name, address, notes, preferred_cleaner_id")
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
    // (manually-added) members included.
    supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .eq("status", "active"),
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
      employees.data?.map((m) => ({
        id: m.id,
        label: memberDisplayName(m),
      })) ?? [],
  };
}
