import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Quiet mode: a company that sends nothing at all. No email, no text, no
 * phone alert, to anyone, whatever part of the app asks.
 *
 * Asked for on 2026-11-24 for the Velluma demo account. Its automations
 * master switch was off and its owner had muted every notice topic, and it
 * still emailed "Fatima hasn't clocked in" to five office accounts: the
 * Needs-you alerts never read the master switch, and topic choices only
 * quiet the person who made them. Each switch covers its own corner; this
 * one covers the doors every message leaves by (lib/email.ts, lib/sms.ts,
 * lib/push.ts, lib/notify.ts), so nothing added later can slip past it.
 *
 * Only the sending stops. The work goes on: visits are made, invoices are
 * drafted, series are extended, and the bell inside the app still lists
 * every notice, so turning quiet mode off leaves nothing to catch up on.
 *
 * Fails OPEN: if the setting can't be read, the company is treated as not
 * quiet. For a demo account that risks one stray email; for a real company
 * the other way round would risk a missed "nobody has clocked in".
 */

export const QUIET_MODE_REASON =
  "This account is in quiet mode, so nothing is sent. Turn it off in Settings, Client messages.";

export async function isOrgQuiet(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const { data, error } = (await createSupabaseAdminClient()
      .from("organizations")
      .select("quiet_mode" as never)
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: { quiet_mode: boolean | null } | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    return data?.quiet_mode === true;
  } catch (err) {
    console.error(`[quiet-mode] could not read the setting for org ${organizationId}; sending as usual:`, err);
    return false;
  }
}
