/**
 * Cron: Data cleanup
 *
 * Runs daily. Removes stale data that is no longer needed:
 *   - Read notifications older than 90 days
 *   - Any notifications (read or unread) older than 365 days
 *   - Audit log entries older than 7 years (financial/personnel compliance)
 *   - Expired invitation tokens older than 30 days
 *   - Expired push subscriptions (unsubscribed)
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const admin = createSupabaseAdminClient();
  const now = new Date();

  // Cutoff dates
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  // Audit logs contain financial and personnel records. 7-year retention
  // aligns with standard accounting / compliance requirements.
  const sevenYearsAgo = new Date(now);
  sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const results: Record<string, number | string> = {};

  try {
    // 1a. Delete read notifications older than 90 days.
    const { count: notifReadCount, error: notifReadErr } = await admin
      .from("notifications" as never)
      .delete({ count: "exact" })
      .not("read_at", "is", null)
      .lt("created_at", ninetyDaysAgo.toISOString());

    if (notifReadErr) {
      results.notifications_read = `error: ${notifReadErr.message}`;
    } else {
      results.notifications_read_deleted = notifReadCount ?? 0;
    }

    // 1b. Hard-delete ALL notifications older than 1 year regardless of
    // read status. Unread notifications can contain PII in their title/body
    // and should not accumulate indefinitely.
    const { count: notifOldCount, error: notifOldErr } = await admin
      .from("notifications" as never)
      .delete({ count: "exact" })
      .lt("created_at", oneYearAgo.toISOString());

    if (notifOldErr) {
      results.notifications_old = `error: ${notifOldErr.message}`;
    } else {
      results.notifications_old_deleted = notifOldCount ?? 0;
    }

    // 2. Delete audit log entries older than 7 years.
    // Financial and personnel records require long-term retention for
    // compliance; 1 year was too short.
    const { count: auditCount, error: auditErr } = await admin
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("created_at", sevenYearsAgo.toISOString());

    if (auditErr) {
      results.audit_log = `error: ${auditErr.message}`;
    } else {
      results.audit_log_deleted = auditCount ?? 0;
    }

    // 3. Delete expired + unclaimed invitations older than 30 days
    const { count: inviteCount, error: inviteErr } = await admin
      .from("invitations")
      .delete({ count: "exact" })
      .is("accepted_at", null)
      .lt("expires_at", thirtyDaysAgo.toISOString());

    if (inviteErr) {
      results.invitations = `error: ${inviteErr.message}`;
    } else {
      results.invitations_deleted = inviteCount ?? 0;
    }

    return Response.json({ ok: true, cleaned: results });
  } catch (err) {
    console.error("[cron/cleanup] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
