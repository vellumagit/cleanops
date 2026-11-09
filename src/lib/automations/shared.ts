import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";

export const admin = () => createSupabaseAdminClient();
/**
 * Check whether a named automation is enabled for an org.
 *
 * Precedence:
 *   1. MASTER SWITCH — organizations.automations_enabled. When false, NOTHING
 *      fires, whatever the per-key settings say. New orgs start false, so a
 *      fresh account is completely silent until the owner opts in.
 *   2. Per-key setting in organizations.automation_settings. Automations are
 *      opt-in: a key with no explicit setting is OFF.
 *
 * On DB read failure we fail CLOSED (return false) rather than falling back to
 * a default — under an opt-in policy, a transient DB hiccup must never
 * surprise-send on behalf of an org that never enabled anything.
 */
export async function isAutomationEnabled(
  organizationId: string,
  key: string,
): Promise<boolean> {
  try {
    const { data } = (await admin()
      .from("organizations")
      .select("automation_settings, automations_enabled")
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: {
        automation_settings: Record<
          string,
          { enabled?: boolean } | null
        > | null;
        automations_enabled: boolean | null;
      } | null;
    };
    if (!data) return false;
    // Master switch off → hard stop.
    if (data.automations_enabled !== true) return false;
    // Unified two-flow model: the org toggle always gates the message type
    // (client flow AND internal flow alike); each client's own preferences
    // then gate delivery downstream via resolveClientNotify. The old
    // per-client routing mode that bypassed org toggles is retired — orgs
    // that used it were grandfathered by migration (client-facing keys
    // enabled + house default "none"), so behavior is unchanged.
    return resolveAutomationEnabled(
      (data.automation_settings as Record<
        string,
        { enabled?: boolean } | undefined
      > | null) ?? null,
      key,
    );
  } catch {
    return false;
  }
}
// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function humanize(s: string | null | undefined): string {
  if (!s) return "Cleaning";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
