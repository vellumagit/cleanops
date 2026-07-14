/**
 * POST /api/push/subscribe
 *
 * Stores a Web Push subscription for the current user. Called from the
 * browser after the user grants notification permission.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    // organizationId in the body is intentionally ignored — we derive the org
    // from the verified membership row instead (see below). Trusting the body
    // value let a user with a valid membership in one org bind their device to
    // a DIFFERENT org and receive that org's org-wide push notifications.
    const { subscription, membershipId } = await request.json();

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth ||
      !membershipId
    ) {
      return NextResponse.json(
        { error: "Missing subscription data" },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();

    // Require an authenticated session — prevents unauthenticated callers
    // from registering push subscriptions against arbitrary memberships.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the membership exists AND belongs to the authenticated user,
    // and pull its organization_id — the subscription is bound to THAT org,
    // never to a client-supplied one. The original check only confirmed the
    // membership row existed, which allowed any authenticated user to register
    // a subscription for any other user's membership by supplying their
    // membershipId in the body.
    const { data: membership } = await supabase
      .from("memberships")
      .select("id, organization_id")
      .eq("id", membershipId)
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Upsert — if the endpoint already exists, update the keys (they can rotate)
    await (supabase
      .from("push_subscriptions" as never)
      .upsert(
        {
          organization_id: (membership as { organization_id: string })
            .organization_id,
          membership_id: membershipId,
          endpoint: subscription.endpoint,
          keys_p256dh: subscription.keys.p256dh,
          keys_auth: subscription.keys.auth,
        } as never,
        { onConflict: "endpoint" },
      ) as unknown as Promise<unknown>);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
