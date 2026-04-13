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
 * The chat_thread_members RLS only allows admins to insert rows, so this
 * action uses the admin client AFTER manually verifying that:
 *   - the other membership belongs to the same active org
 *   - the other membership is not the caller themselves
 *
 * If a DM thread already exists between these two members, it is reused
 * instead of duplicated.
 */
export async function createDmThreadAction(
  otherMembershipId: string,
): Promise<Result<{ thread_id: string }>> {
  if (!otherMembershipId) return { ok: false, error: "Pick a teammate" };

  const { membership, supabase } = await getActionContext();
  if (otherMembershipId === membership.id) {
    return { ok: false, error: "You cannot DM yourself" };
  }

  const { data: other, error: otherErr } = await supabase
    .from("memberships")
    .select("id, organization_id, status")
    .eq("id", otherMembershipId)
    .maybeSingle();

  if (otherErr || !other) return { ok: false, error: "Teammate not found" };
  if (other.organization_id !== membership.organization_id)
    return { ok: false, error: "Teammate is not in your organization" };
  if (other.status !== "active")
    return { ok: false, error: "Teammate is not active" };

  // Look for an existing DM thread that has BOTH members.
  const { data: myThreads } = await supabase
    .from("chat_thread_members")
    .select("thread_id, thread:chat_threads ( id, kind )")
    .eq("membership_id", membership.id);

  const myDmThreadIds = (myThreads ?? [])
    .filter((m) => m.thread?.kind === "dm")
    .map((m) => m.thread_id);

  if (myDmThreadIds.length > 0) {
    const { data: shared } = await supabase
      .from("chat_thread_members")
      .select("thread_id")
      .eq("membership_id", otherMembershipId)
      .in("thread_id", myDmThreadIds);

    const existing = shared?.[0]?.thread_id;
    if (existing) {
      return { ok: true, thread_id: existing };
    }
  }

  // None found — create a new DM thread + both member rows via the admin
  // client (RLS only allows admins to insert into chat_thread_members, but
  // any member should be able to start a DM with a teammate).
  const admin = createSupabaseAdminClient();

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
    return {
      ok: false,
      error: threadErr?.message ?? "Could not create thread",
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
    await admin.from("chat_threads").delete().eq("id", thread.id);
    return { ok: false, error: membersErr.message };
  }

  revalidatePath("/app/chat");
  revalidatePath("/field/chat");
  return { ok: true, thread_id: thread.id };
}
