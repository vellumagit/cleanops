/**
 * Disconnect the org's Stripe Connect account. POST only.
 */

import { NextResponse } from "next/server";
import { requireActionMembership } from "@/lib/auth";
import { disconnectAccount } from "@/lib/stripe-connect";
import { isStripeConnectEnabled } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isStripeConnectEnabled()) {
    return NextResponse.json(
      { error: "Stripe Connect is not configured" },
      { status: 503 },
    );
  }
  const membership = await requireActionMembership(["owner", "admin"]);
  await disconnectAccount({ organizationId: membership.organization_id });
  return NextResponse.json({ disconnected: true });
}
