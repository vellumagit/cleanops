/**
 * Per-org feed feature visibility.
 *
 * The feed (team activity stream) defaults to OFF for new orgs —
 * not every owner wants a social-style space in their workflow. When
 * disabled:
 *
 *   - The "Feed" link is hidden from both the admin and field
 *     sidebars.
 *   - /app/feed and /field/feed return 404 so a bookmarked URL
 *     doesn't surface the page anyway.
 *
 * Controlled via the `feed_visible` automation toggle (Settings →
 * Automations → Feed section). The `system_feed_events` toggle is
 * a separate, secondary control for whether auto-generated posts
 * appear — it only matters when feed_visible is true.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";

/**
 * Returns true if the feed feature is enabled for the given org.
 * Reads the org's automation_settings JSONB blob and resolves
 * against the DEFAULT_OFF policy (feed_visible defaults to false).
 *
 * Uses the admin client so the check can run from anywhere (sidebar
 * layouts, feed pages, server actions) without RLS surprises. The
 * organization_id comes from the authenticated membership so there's
 * no leakage.
 */
export async function isFeedVisible(organizationId: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("organizations")
      .select("automation_settings")
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: {
        automation_settings:
          | Record<string, { enabled?: boolean } | undefined>
          | null;
      } | null;
    };
    return resolveAutomationEnabled(
      data?.automation_settings ?? null,
      "feed_visible",
    );
  } catch {
    // On read error, hide the feed — safer than showing it
    // unexpectedly, matches the default-OFF policy.
    return false;
  }
}
