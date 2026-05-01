import "server-only";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";

export type CleanerOption = { id: string; label: string };
export type ReferralClientOption = { id: string; name: string };

/**
 * Fetch the active membership list for the client form's "preferred
 * cleaner" dropdown. Same fallback chain as everywhere else
 * (display_name → profile.full_name → "Unknown") so shadow members
 * and invited members look identical in the picker.
 */
export async function fetchClientFormCleaners(): Promise<CleanerOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select(
      "id, display_name, profile:profiles ( full_name )",
    )
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (data ?? [])
    .map((m) => ({
      id: m.id,
      label: memberDisplayName(m),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Fetch all active clients in the org for the "Referred by" dropdown.
 * Optionally excludes one client id (to prevent a client referring themselves
 * when editing their own record).
 */
export async function fetchReferralClients(
  excludeId?: string,
): Promise<ReferralClientOption[]> {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .eq("organization_id" as never, membership.organization_id as never)
    .order("name", { ascending: true }) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  return (data ?? []).filter((c) => c.id !== excludeId);
}
