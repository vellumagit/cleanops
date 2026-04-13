/**
 * POST /api/push/unsubscribe
 *
 * Removes a push subscription when the user disables notifications.
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

    await (supabase
      .from("push_subscriptions" as never)
      .delete()
      .eq("endpoint", endpoint) as unknown as Promise<unknown>);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/unsubscribe]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
