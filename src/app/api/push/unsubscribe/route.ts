/**
 * POST /api/push/unsubscribe
 *
 * Removes a push subscription when the user disables notifications.
 *
 * Security: we verify the caller is authenticated AND that the subscription
 * they want to remove actually belongs to one of their memberships. Without
 * this check any logged-in user could disable another user's push
 * notifications by supplying their endpoint URL.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { endpoint } = await request.json();

    if (!endpoint) {
      return NextResponse.json(
        { error: "Missing endpoint" },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();

    // Require an authenticated session.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up the subscription row so we can verify ownership before deleting.
    const { data: sub } = (await supabase
      .from("push_subscriptions" as never)
      .select("id, membership_id")
      .eq("endpoint", endpoint)
      .maybeSingle()) as unknown as {
      data: { id: string; membership_id: string } | null;
    };

    if (!sub) {
      // Nothing to remove — return success so the client doesn't retry.
      return NextResponse.json({ ok: true });
    }

    // Confirm the subscription belongs to a membership owned by this user.
    const { data: ownerCheck } = await supabase
      .from("memberships")
      .select("id")
      .eq("id", sub.membership_id)
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!ownerCheck) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await (supabase
      .from("push_subscriptions" as never)
      .delete()
      .eq("id", sub.id) as unknown as Promise<unknown>);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/unsubscribe]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
