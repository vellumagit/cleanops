/**
 * Cron: Trial expiring email reminders
 *
 * Runs daily. Handles two trial systems:
 *
 *   1. Stripe-managed trials — orgs with a `subscriptions` row where
 *      status = "trialing". Deduped via subscriptions.last_event_id.
 *
 *   2. Self-managed trials — orgs with organizations.trial_started_at set
 *      but no Stripe subscription yet (onboarded before Stripe was wired up,
 *      or still on the freemium path). Trial length = SELF_TRIAL_DAYS (14).
 *      Deduped via organizations.trial_reminder_key.
 *
 * Both paths send the same trialExpiringEmail template at 3 days, 1 day,
 * and 0 days (day-of) before the trial ends.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { trialExpiringEmail } from "@/lib/email-templates";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_DAYS = [3, 1, 0]; // Fire at 3 days, 1 day, and day-of
const SELF_TRIAL_DAYS = 14;      // Self-managed trial length

// ---------------------------------------------------------------------------
// Helper: send reminder emails to all owner/admin members of an org.
// Returns the number of emails successfully dispatched.
// ---------------------------------------------------------------------------

async function sendTrialReminders(
  orgId: string,
  orgName: string,
  brandColor: string | undefined,
  daysLeft: number,
  siteUrl: string,
): Promise<number> {
  const admin = createSupabaseAdminClient();
  let sent = 0;

  const { data: owners } = await admin
    .from("memberships")
    .select("profile_id")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin"])
    .eq("status", "active");

  if (!owners || owners.length === 0) return 0;

  for (const owner of owners) {
    if (!owner.profile_id) continue;

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", owner.profile_id)
      .maybeSingle();

    // Get email from Supabase auth.users
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
      brandColor,
    });

    await sendEmail({
      to: userData.email,
      toName: profile?.full_name ?? undefined,
      ...template,
    });

    sent++;
  }

  return sent;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const admin = createSupabaseAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    let sent = 0;

    // -----------------------------------------------------------------------
    // Path 1: Stripe-managed trials (subscriptions.trial_ends_at)
    // -----------------------------------------------------------------------

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

    // Collect Stripe-trialing org IDs so the self-managed loop can skip them.
    const stripeTrialingOrgIds = new Set((subs ?? []).map((s) => s.organization_id));

    for (const sub of subs ?? []) {
      if (!sub.trial_ends_at) continue;

      const msLeft = new Date(sub.trial_ends_at).getTime() - Date.now();
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

      if (!REMINDER_DAYS.includes(daysLeft)) continue;

      const dedupeKey = `trial_reminder_${daysLeft}`;
      if (sub.last_event_id === dedupeKey) continue;

      const { data: org } = await admin
        .from("organizations")
        .select("name, brand_color")
        .eq("id", sub.organization_id)
        .maybeSingle() as unknown as {
        data: { name: string; brand_color: string | null } | null;
      };

      const orgCount = await sendTrialReminders(
        sub.organization_id,
        org?.name ?? "your organization",
        org?.brand_color ?? undefined,
        daysLeft,
        siteUrl,
      );
      sent += orgCount;

      // Stamp the dedup key so a re-run on the same day is a no-op.
      await admin
        .from("subscriptions")
        .update({ last_event_id: dedupeKey } as never)
        .eq("organization_id", sub.organization_id);
    }

    // -----------------------------------------------------------------------
    // Path 2: Self-managed trials (organizations.trial_started_at)
    //
    // These orgs registered via the self-service flow and haven't connected
    // Stripe yet. The trial clock is trial_started_at + SELF_TRIAL_DAYS.
    // -----------------------------------------------------------------------

    const { data: selfOrgsRaw } = await admin
      .from("organizations")
      .select("id, name, brand_color, trial_started_at, trial_reminder_key" as never)
      .not("trial_started_at", "is", null);

    const selfOrgs = selfOrgsRaw as Array<{
      id: string;
      name: string;
      brand_color: string | null;
      trial_started_at: string;
      trial_reminder_key: string | null;
    }> | null;

    for (const org of selfOrgs ?? []) {
      // Skip if Stripe is already handling this org's trial.
      if (stripeTrialingOrgIds.has(org.id)) continue;

      const trialEndMs =
        new Date(org.trial_started_at).getTime() +
        SELF_TRIAL_DAYS * 24 * 60 * 60 * 1000;
      const msLeft = trialEndMs - Date.now();
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

      if (!REMINDER_DAYS.includes(daysLeft)) continue;

      const dedupeKey = `trial_reminder_${daysLeft}`;
      if (org.trial_reminder_key === dedupeKey) continue;

      const orgCount = await sendTrialReminders(
        org.id,
        org.name ?? "your organization",
        org.brand_color ?? undefined,
        daysLeft,
        siteUrl,
      );
      sent += orgCount;

      // Stamp the dedup key.
      await admin
        .from("organizations")
        .update({ trial_reminder_key: dedupeKey } as never)
        .eq("id", org.id);
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
