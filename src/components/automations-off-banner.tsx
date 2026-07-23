import Link from "next/link";
import { Zap } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Nudge shown while an org's automations master switch is off.
 *
 * Automations are opt-in, so a brand-new org is completely silent — no
 * confirmations, reminders, invoices, or digests. That's deliberate, but it
 * would be baffling to discover by noticing nothing ever happened. This makes
 * the state visible and gives owners a one-click route to configure it.
 *
 * Owners/admins only — a cleaner can't change org settings, so it'd be noise.
 */
export async function AutomationsOffBanner({
  organizationId,
  role,
}: {
  organizationId: string;
  role: string;
}) {
  if (!["owner", "admin"].includes(role)) return null;

  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("organizations")
    .select("automations_enabled")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: { automations_enabled: boolean | null } | null;
  };

  // Absent column (migration not run yet) → don't nag.
  if (!data || data.automations_enabled !== false) return null;

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Zap className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span className="font-medium text-foreground">
          Automations are off
        </span>
        <span className="text-muted-foreground">
          No confirmations, reminders, invoices, or review requests are being
          sent. Choose which ones you want — for the whole business, or per
          client.
        </span>
        <Link
          href="/app/settings/automations"
          className="ml-auto shrink-0 rounded-md border border-border bg-background px-2.5 py-1 font-medium hover:bg-muted"
        >
          Set up automations
        </Link>
      </div>
    </div>
  );
}
