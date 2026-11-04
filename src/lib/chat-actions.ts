"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership } from "@/lib/push";
import {
  CHAT_MEDIA_BUCKET,
  CHAT_PHOTO_MAX_BYTES,
  chatMediaPrefix,
  chatPhotoExtension,
  chatPhotoType,
  chatPreviewText,
  isChatMediaPath,
  validateChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-media-rules";

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : T))
  | { ok: false; error: string };

const SIGNED_URL_SECONDS = 60 * 60 * 2;

/** Is this membership in this thread? Read with the service role, scoped by org. */
async function isThreadMember(
  orgId: string,
  membershipId: string,
  threadId: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("chat_thread_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("thread_id", threadId)
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (error) {
    console.error("[chat] thread membership read failed:", error.message);
    return false;
  }
  return Boolean(data);
}

/** Signed read URLs for photo paths, keyed by path. Missing on failure. */
async function signChatPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);
  const out: Record<string, string> = {};
  for (const s of data ?? []) {
    if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
  }
  return out;
}

/**
 * Step 1 of sending a photo: check the sender is in the thread and the file
 * is a photo of a sendable size, then hand back a one-time signed upload
 * URL. The phone uploads straight to storage on it (a server action can't
 * carry the file: Vercel caps a request at 4.5 MB), then sends the message
 * with the path in `attachments`.
 */
export async function prepareChatPhotoUploadAction(input: {
  threadId: string;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<Result<{ path: string; token: string; mimeType: string }>> {
  if (!input.threadId) return { ok: false, error: "Missing thread" };
  const mime = chatPhotoType(input.mimeType ?? "", input.fileName ?? "");
  if (!mime) return { ok: false, error: "Only photos (JPG, PNG, HEIC, WebP) can be sent here." };
  if (!(input.size > 0)) return { ok: false, error: "That file is empty." };
  if (input.size > CHAT_PHOTO_MAX_BYTES) return { ok: false, error: "Photos must be under 20 MB." };

  const { membership } = await getActionContext();
  if (!(await isThreadMember(membership.organization_id, membership.id, input.threadId))) {
    return { ok: false, error: "You're not in this conversation." };
  }

  const path = `${chatMediaPrefix(membership.organization_id, input.threadId)}${crypto.randomUUID()}.${chatPhotoExtension(mime)}`;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[chat] signed upload url failed:", error?.message);
    return { ok: false, error: "Couldn't start the upload. Try again." };
  }
  return { ok: true, path, token: data.token, mimeType: mime };
}

/**
 * Fresh read URLs for photos in a thread the caller belongs to. The
 * realtime insert carries only storage paths, and the bucket is private, so
 * a phone that sees a new photo message asks here for something it can show.
 */
export async function signChatPhotosAction(
  threadId: string,
  paths: string[],
): Promise<Result<{ urls: Record<string, string> }>> {
  if (!threadId) return { ok: false, error: "Missing thread" };
  const { membership } = await getActionContext();
  const wanted = (Array.isArray(paths) ? paths : [])
    .filter((p) => isChatMediaPath(p, membership.organization_id, threadId))
    .slice(0, 60);
  if (wanted.length === 0) return { ok: true, urls: {} };
  if (!(await isThreadMember(membership.organization_id, membership.id, threadId))) {
    return { ok: false, error: "You're not in this conversation." };
  }
  return { ok: true, urls: await signChatPhotoUrls(wanted) };
}

/**
 * Send a chat message into a thread the current user belongs to.
 *
 * RLS on chat_messages enforces that the sender_id matches a membership of
 * the current user AND the thread is one they belong to, so we don't need
 * extra checks here. The supabase_realtime publication broadcasts the insert
 * to every subscribed client.
 *
 * `attachments` are photos already uploaded through
 * prepareChatPhotoUploadAction; each path must sit under this org and
 * thread and the file must actually be in storage. A message may be photos
 * alone, words alone, or both.
 */
export async function sendChatMessageAction(
  threadId: string,
  body: string,
  attachmentsInput?: unknown,
): Promise<Result<{ id: string; urls: Record<string, string> }>> {
  const trimmed = (body ?? "").trim();
  if (!threadId) return { ok: false, error: "Missing thread" };
  if (trimmed.length > 10000)
    return { ok: false, error: "Message is too long" };

  const { membership, supabase } = await getActionContext();

  const checked = validateChatAttachments(attachmentsInput, membership.organization_id, threadId);
  if (!checked.ok) return checked;
  const attachments: ChatAttachment[] = checked.attachments;
  if (trimmed.length === 0 && attachments.length === 0) {
    return { ok: false, error: "Message is empty" };
  }

  // PCI guard: chat messages are stored long-term in chat_messages.body
  // and readable by every member of the thread. Reject Luhn-validated
  // PANs before persisting.
  if (trimmed.length > 0) {
    const { noCardNumber, CARD_DETECTED_MESSAGE } = await import(
      "@/lib/card-detection"
    );
    if (!noCardNumber(trimmed)) {
      return { ok: false, error: CARD_DETECTED_MESSAGE };
    }
  }

  // Did every photo actually land? A path the phone made up, or an upload
  // that died halfway, must not become a broken picture in the thread.
  if (attachments.length > 0) {
    const admin = createSupabaseAdminClient();
    const folder = chatMediaPrefix(membership.organization_id, threadId).slice(0, -1);
    for (const a of attachments) {
      const name = a.path.slice(folder.length + 1);
      const { data: listed, error: listErr } = await admin.storage
        .from(CHAT_MEDIA_BUCKET)
        .list(folder, { search: name, limit: 1 });
      if (listErr) {
        console.error("[chat] attachment check failed:", listErr.message);
        return { ok: false, error: "Couldn't confirm the photo uploaded. Try again." };
      }
      const obj = (listed ?? []).find((o) => o.name === name);
      if (!obj) return { ok: false, error: "A photo didn't finish uploading. Try again." };
      const stored = Number((obj.metadata as { size?: number } | null)?.size);
      if (stored > 0) a.size = stored;
    }
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      organization_id: membership.organization_id,
      thread_id: threadId,
      sender_id: membership.id,
      // The check constraint allows an empty body only with attachments.
      body: trimmed,
      attachments: attachments as unknown as never,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (attachments.length > 0) {
      await createSupabaseAdminClient()
        .storage.from(CHAT_MEDIA_BUCKET)
        .remove(attachments.map((a) => a.path))
        .catch(() => {});
    }
    return { ok: false, error: error?.message ?? "Could not send message" };
  }

  const urls = await signChatPhotoUrls(attachments.map((a) => a.path));
  const preview = chatPreviewText(trimmed, attachments.length);

  // Push the other thread members. Inside after(), not fire-and-forget:
  // a promise left running when a server action returns is frozen with the
  // function on Vercel, so the push often never left — managers heard
  // nothing when a cleaner wrote in chat (Olha, 2026-11-03). after() keeps
  // the function alive until the sends finish, without holding up the reply.
  const senderMembershipId = membership.id;
  const senderProfileId = membership.profile_id;
  after(async () => {
    const adminDb = createSupabaseAdminClient();
    const [membersResult, senderResult] = await Promise.all([
      adminDb
        .from("chat_thread_members")
        .select("membership_id, member:memberships ( role )")
        .eq("thread_id", threadId)
        .neq("membership_id", senderMembershipId) as unknown as Promise<{
        data: Array<{ membership_id: string; member: { role: string } | null }> | null;
      }>,
      adminDb
        .from("memberships")
        .select("display_name, profile:profiles ( full_name )")
        .eq("id", senderMembershipId)
        .maybeSingle() as unknown as Promise<{
        data: { display_name: string | null; profile: { full_name: string | null } | null } | null;
      }>,
    ]);
    const members = membersResult?.data ?? [];
    if (members.length === 0) return;
    const sender = senderResult?.data;
    let senderName = sender?.display_name?.trim() || sender?.profile?.full_name?.trim() || "";
    if (!senderName) {
      const { data: prof } = await adminDb
        .from("profiles")
        .select("full_name")
        .eq("id", senderProfileId)
        .maybeSingle();
      senderName = prof?.full_name?.trim() || "Someone";
    }
    await Promise.allSettled(
      members.map((m) =>
        sendPushToMembership(m.membership_id, {
          title: `New message from ${senderName}`,
          body: preview,
          // Office staff read chat in the office app; cleaners in the field app.
          href: ["owner", "admin", "manager"].includes(m.member?.role ?? "")
            ? "/app/chat"
            : "/field/chat",
          // One notification per conversation, replaced by the newest line,
          // instead of a pile of them.
          tag: `chat:${threadId}`,
        }),
      ),
    );
  });

  revalidatePath("/app/chat");
  revalidatePath("/field/chat");
  return { ok: true, id: data.id, urls };
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
/**
 * Mark a thread read for the current member (advances their last_read_at
 * watermark to now via the SECURITY DEFINER helper). Fire-and-forget from
 * the client when a thread is opened or a message arrives while viewing.
 */
export async function markThreadReadAction(threadId: string): Promise<void> {
  if (!threadId) return;
  const { supabase } = await getActionContext();
  await supabase.rpc("chat_mark_thread_read" as never, {
    p_thread_id: threadId,
  } as never);
}

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
    .select("id, organization_id, status, profile_id")
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
  // A teammate with no login account (manually-added shadow employee)
  // can't open the app to read a DM — block it with a clear reason
  // rather than silently creating a thread nobody will ever see.
  if (!(other as { profile_id: string | null }).profile_id) {
    return {
      ok: false,
      error:
        "This teammate hasn't joined the app yet, so they can't receive messages. Invite them (or have them accept their invite) first.",
    };
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
