/**
 * Create a Stripe Checkout Session for Sollos 3 subscription signup.
 *
 * Called from the pricing page and the billing settings page. The caller
 * posts { plan: 'starter' | 'growth' }; we resolve the authenticated user's
 * org + email server-side (nothing is trusted from the body beyond the plan).
 *
 * Redirect URLs are computed from NEXT_PUBLIC_SITE_URL so an attacker can't
 * smuggle an arbitrary returnTo through the body.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireMembership, getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createCheckoutSession,
  isStripeEnabled,
  type PlanTier,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PLANS: PlanTier[] = ["starter", "growth"];

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe is not enabled" },
      { status: 503 },
    );
  }

  const membership = await requireMembership(["owner", "admin"]);

  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const plan = body.plan as PlanTier;
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  // A workspace that is suspended, flagged or already deleted cannot buy a
  // plan. Suspension was only ever enforced on FEATURES — sending email,
  // creating clients — and never on billing, so a banned workspace kept a
  // working login, a membership row that still said owner, and an open door
  // to Stripe Checkout.
  //
  // PakkeDao walked through it: suspended 2026-09-15 for mailing 32,000
  // phishing messages, purged 2026-09-23, and on 2026-09-28 — five days after
  // its data was deleted — it opened a Growth subscription. A dead workspace
  // putting a card through is not a sale, it is somebody finding out whether
  // the card works, and the cost of that lands on this Stripe account as
  // declines and chargebacks.
  //
  // Checked against the org row rather than the membership, because the purge
  // erases auth identities last and best-effort: the login can outlive the
  // workspace, which is exactly what happened here.
  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("suspended_at, deleted_at, abuse_flagged_at")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      suspended_at: string | null;
      deleted_at: string | null;
      abuse_flagged_at: string | null;
    } | null;
  };

  // No row means the org is gone entirely — refuse rather than fall through.
  if (!org || org.deleted_at || org.suspended_at || org.abuse_flagged_at) {
    console.warn(
      `[stripe/checkout] refused for org ${membership.organization_id} — ` +
        `deleted=${Boolean(org?.deleted_at)} suspended=${Boolean(org?.suspended_at)} flagged=${Boolean(org?.abuse_flagged_at)}`,
    );
    return NextResponse.json(
      {
        error:
          "This workspace can't start a subscription. Contact support@sollos3.com.",
      },
      { status: 403 },
    );
  }

  const user = await getCurrentUser();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  let url: string | null;
  try {
    url = await createCheckoutSession({
      organizationId: membership.organization_id,
      email: user?.email ?? "",
      plan,
      successUrl: `${siteUrl}/app/settings/billing?checkout=success`,
      cancelUrl: `${siteUrl}/app/settings/billing?checkout=cancelled`,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Stripe error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!url) {
    return NextResponse.json(
      { error: "Checkout plan is not configured. Contact support." },
      { status: 500 },
    );
  }
  return NextResponse.json({ url });
}
