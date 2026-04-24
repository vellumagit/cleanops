"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership } from "@/lib/push";

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : T))
  | { ok: false; error: string };

/**
 * Send a chat message into a thread the current user belongs to.
 *
 * RLS on chat_messages enforces that the sender_id matches a membership of
 * the current user AND the thread is one they belong to, so we don't need
 * extra checks here. The supabase_realtime publication broadcasts the insert
 * to every subscribed client.
 */
export async function sendChatMessageAction(
  threadId: string,
  body: string,
): Promise<Result<{ id: string }>> {
  const trimmed = body.trim();
  if (!threadId) return { ok: false, error: "Missing thread" };
  if (trimmed.length === 0) return { ok: false, error: "Message is empty" };
  if (trimmed.length > 10000)
    return { ok: false, error: "Message is too long" };

  const { membership, supabase } = await getActionContext();

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      organization_id: membership.organization_id,
      thread_id: threadId,
      sender_id: membership.id,
      body: trimmed,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not send message" };
  }

  // Fire-and-forget push notifications to other thread members
  const adminDb = createSupabaseAdminClient();
  Promise.all([
    adminDb
      .from("chat_thread_members")
      .select("membership_id")
      .eq("thread_id", threadId)
      .neq("membership_id", membership.id),
    adminDb
      .from("profiles")
      .select("full_name")
      .eq("id", membership.profile_id)
      .maybeSingle(),
  ])
    .then(([membersResult, profileResult]) => {
      const members = membersResult?.data;
      if (!members || members.length === 0) return;
      const senderName = profileResult?.data?.full_name ?? "Someone";
      const preview =
        trimmed.length > 80 ? trimmed.slice(0, 80) + "..." : trimmed;
      for (const m of members) {
        sendPushToMembership(m.membership_id, {
          title: `New message from ${senderName}`,
          body: preview,
          href: "/field/chat",
        }).catch(() => {});
      }
    })
    .catch(() => {});

  revalidatePath("/app/chat");
  revalidatePath("/field/chat");
  return { ok: true, id: data.id };
}

/**
 * Open (or reuse) a 1:1 DM thread between the current user and another
 * membership in the same organization.
 *
 * Employees reported "I can't create a new DM" — the action was a mix
 * of RLS-bound SELECTs (to verify the other member + find existing
 * threads) and admin-client INSERTs. An employee's RLS-scoped SELECT
 * on chat_thread_members can mask an existing DM, which then confuses
 * the create path. It's also easy for the initial teammate lookup to
 * silently return null on certain membership-RLS edge cases.
 *
 * Rewritten to use the admin client for ALL reads + writes here. The
 * action is authorized at the role / context layer (getActionContext
 * already verified the caller is a signed-in member) and we still
 * strictly validate that:
 *   - the other membership is in the caller's org
 *   - they're both active
 *   - you're not DMing yourself
 *
 * All errors are logged — [chat] createDmThreadAction prefix — so the
 * next silent failure shows up in Vercel logs instead of a generic
 * error toast.
 */
export async function createDmThreadAction(
  otherMembershipId: string,
): Promise<Result<{ thread_id: string }>> {
  if (!otherMembershipId) return { ok: false, error: "Pick a teammate" };

  const { membership } = await getActionContext();
  if (otherMembershipId === membership.id) {
    return { ok: false, error: "You cannot DM yourself" };
  }

  const admin = createSupabaseAdminClient();

  const { data: other, error: otherErr } = await admin
    .from("memberships")
    .select("id, organization_id, status")
    .eq("id", otherMembershipId)
    .maybeSingle();

  if (otherErr) {
    console.error(
      "[chat] createDmThreadAction teammate lookup failed:",
      otherErr.message,
    );
    return { ok: false, error: "Couldn't verify that teammate." };
  }
  if (!other) return { ok: false, error: "Teammate not found." };
  if (other.organization_id !== membership.organization_id) {
    return { ok: false, error: "Teammate is not in your organization." };
  }
  if (other.status !== "active") {
    return { ok: false, error: "Teammate is not active." };
  }

  // Existing-DM lookup via admin client — if it returns nothing under
  // RLS, we'd incorrectly create a duplicate DM thread.
  const { data: myRows } = await admin
    .from("chat_thread_members")
    .select("thread_id, thread:chat_threads ( id, kind )")
    .eq("membership_id", membership.id)
    .limit(500);

  const myDmThreadIds = (myRows ?? [])
    .filter((m) => m.thread?.kind === "dm")
    .map((m) => m.thread_id);

  if (myDmThreadIds.length > 0) {
    const { data: shared } = await admin
      .from("chat_thread_members")
      .select("thread_id")
      .eq("membership_id", otherMembershipId)
      .in("thread_id", myDmThreadIds);

    const existing = shared?.[0]?.thread_id;
    if (existing) {
      return { ok: true, thread_id: existing };
    }
  }

  // No existing DM — create the new thread + both member rows.
  const { data: thread, error: threadErr } = await admin
    .from("chat_threads")
    .insert({
      organization_id: membership.organization_id,
      kind: "dm",
      name: null,
    })
    .select("id")
    .single();

  if (threadErr || !thread) {
    console.error(
      "[chat] createDmThreadAction thread insert failed:",
      threadErr?.message,
    );
    return {
      ok: false,
      error: threadErr?.message ?? "Could not create thread.",
    };
  }

  const { error: membersErr } = await admin
    .from("chat_thread_members")
    .insert([
      {
        organization_id: membership.organization_id,
        thread_id: thread.id,
        membership_id: membership.id,
      },
      {
        organization_id: membership.organization_id,
        thread_id: thread.id,
        membership_id: otherMembershipId,
      },
    ]);

  if (membersErr) {
    console.error(
      "[chat] createDmThreadAction member insert failed, rolling back:",
      membersErr.message,
    );
    await admin.from("chat_threads").delete().eq("id", thread.id);
    return { ok: false, error: membersErr.message };
  }

  revalidatePath("/app/chat");
  revalidatePath("/field/chat");
  return { ok: true, thread_id: thread.id };
}
