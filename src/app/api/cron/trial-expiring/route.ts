/**
 * Cron: Trial expiring email reminders
 *
 * Runs daily. Finds orgs whose trial ends in 3 days, 1 day, or today,
 * and emails the owner a warning with a link to subscribe.
 *
 * Dedupes by storing the last reminder day count in the subscription row
 * so the same org doesn't get spammed on redelivery.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { trialExpiringEmail } from "@/lib/email-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_DAYS = [3, 1, 0]; // Fire at 3 days, 1 day, and day-of

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    // Find all trialing subscriptions
    const { data: subsRaw } = await admin
      .from("subscriptions")
      .select("organization_id, trial_ends_at, last_event_id" as never)
      .eq("status", "trialing")
      .not("trial_ends_at", "is", null);

    const subs = subsRaw as Array<{
      organization_id: string;
      trial_ends_at: string | null;
      last_event_id: string | null;
    }> | null;

    if (!subs || subs.length === 0) {
      return Response.json({ sent: 0, message: "No active trials" });
    }

    let sent = 0;

    for (const sub of subs) {
      if (!sub.trial_ends_at) continue;

      const msLeft =
        new Date(sub.trial_ends_at).getTime() - Date.now();
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

      // Only fire on the specific reminder days
      if (!REMINDER_DAYS.includes(daysLeft)) continue;

      // Dedupe: last_event_id stores "trial_reminder_N" so we don't
      // send the same day's reminder twice.
      const dedupeKey = `trial_reminder_${daysLeft}`;
      if (sub.last_event_id === dedupeKey) continue;

      // Find the owner(s) of this org
      const { data: owners } = await admin
        .from("memberships")
        .select("profile_id, organization_id")
        .eq("organization_id", sub.organization_id)
        .in("role", ["owner", "admin"])
        .eq("status", "active");

      if (!owners || owners.length === 0) continue;

      // Get the org name
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", sub.organization_id)
        .maybeSingle();

      const orgName = org?.name ?? "your organization";

      // Get each owner's email and name from profiles + auth
      for (const owner of owners) {
        const { data: profile } = await admin
          .from("profiles")
          .select("full_name")
          .eq("id", owner.profile_id)
          .maybeSingle();

        // Get email from auth.users
        const userRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${owner.profile_id}`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
          },
        );

        if (!userRes.ok) continue;
        const userData = (await userRes.json()) as { email?: string };
        if (!userData.email) continue;

        const template = trialExpiringEmail({
          userName: profile?.full_name ?? "there",
          orgName,
          daysLeft: Math.max(0, daysLeft),
          billingUrl: `${siteUrl}/app/settings/billing`,
        });

        await sendEmail({
          to: userData.email,
          toName: profile?.full_name ?? undefined,
          ...template,
        });

        sent++;
      }

      // Mark this reminder as sent
      await admin
        .from("subscriptions")
        .update({ last_event_id: dedupeKey } as never)
        .eq("organization_id", sub.organization_id);
    }

    return Response.json({ sent });
  } catch (err) {
    console.error("[cron/trial-expiring] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
