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
