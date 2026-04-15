/**
 * Create a Stripe Billing Portal session so the user can manage their
 * subscription (update payment method, cancel, download invoices).
 */

import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import {
  createBillingPortalSession,
  isStripeEnabled,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Stripe is not enabled" },
      { status: 503 },
    );
  }
  const membership = await requireMembership(["owner", "admin"]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const url = await createBillingPortalSession({
    organizationId: membership.organization_id,
    returnUrl: `${siteUrl}/app/settings/billing`,
  });
  if (!url) {
    return NextResponse.json(
      { error: "No subscription yet" },
      { status: 400 },
    );
  }
  return NextResponse.json({ url });
}
