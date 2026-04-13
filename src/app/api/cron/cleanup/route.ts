/**
 * Cron: Data cleanup
 *
 * Runs daily. Removes stale data that is no longer needed:
 *   - Read notifications older than 90 days
 *   - Audit log entries older than 365 days
 *   - Expired invitation tokens older than 30 days
 *   - Expired push subscriptions (unsubscribed)
 *
 * Protected by CRON_SECRET — Vercel passes this in the Authorization header.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();

  // Cutoff dates
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const results: Record<string, number | string> = {};

  try {
    // 1. Delete read notifications older than 90 days
    const { count: notifCount, error: notifErr } = await admin
      .from("notifications" as never)
      .delete({ count: "exact" })
      .not("read_at", "is", null)
      .lt("created_at", ninetyDaysAgo.toISOString());

    if (notifErr) {
      results.notifications = `error: ${notifErr.message}`;
    } else {
      results.notifications_deleted = notifCount ?? 0;
    }

    // 2. Delete audit log entries older than 1 year
    const { count: auditCount, error: auditErr } = await admin
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("created_at", oneYearAgo.toISOString());

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
