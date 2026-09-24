"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { sendChatMessageAction } from "@/lib/chat-actions";

/**
 * "Announce to team" — one message, every channel the org has.
 *
 * Before this, telling everyone something meant posting in #general and hoping.
 * That reaches whoever opens the app, and pushes only those with notifications
 * enabled — on Svit that was 6 subscriptions across 16 active people. Email is
 * the channel that actually lands, and nothing could send one to the roster.
 *
 * Three deliveries, in this order:
 *
 *   1. A message in #general, so the announcement has a home people can
 *      scroll back to and reply in. sendChatMessageAction pushes every other
 *      member of that thread as a side effect.
 *   2. An org-wide notification row, so it persists in the bell rather than
 *      scrolling away in chat.
 *   3. Email, only if asked for. Opt-in per announcement — a shift swap does
 *      not deserve an inbox, and a team that gets mailed about everything
 *      stops reading any of it.
 *
 * Push is deliberately left to step 1 when the chat post lands: notify's
 * org-wide push addresses the same devices, and firing both buzzes everyone
 * twice for one announcement. When there is no #general to post into, step 2
 * takes the push back over.
 */

export type AnnounceState = {
  error?: string;
  /** sentAt doubles as a remount key for the form, so a success clears the
   *  fields and the email checkbox without a setState-in-effect. */
  sent?: { chat: boolean; emailed: number; email: boolean; sentAt: number };
  values?: { title: string; body: string; email: boolean };
};

const MAX_TITLE = 120;
const MAX_BODY = 5000;

export async function sendAnnouncementAction(
  _prev: AnnounceState,
  formData: FormData,
): Promise<AnnounceState> {
  const title = String(formData.get("title") ?? "").trim().slice(0, MAX_TITLE);
  const body = String(formData.get("body") ?? "").trim().slice(0, MAX_BODY);
  const wantsEmail = formData.get("email") === "on";
  const values = { title, body, email: wantsEmail };
  const fail = (error: string): AnnounceState => ({ error, values });

  if (!title) return fail("Give the announcement a subject.");
  if (!body) return fail("Write the announcement.");

  // Same guard the feed and chat use: this persists and every employee can
  // read it, so a card number must not get in.
  const { noCardNumber, CARD_DETECTED_MESSAGE } = await import(
    "@/lib/card-detection"
  );
  if (!noCardNumber(`${title}\n${body}`)) return fail(CARD_DETECTED_MESSAGE);

  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return fail("Only owners, admins and managers can announce to the team.");
  }

  const admin = createSupabaseAdminClient();

  // Which #general? An org can end up with more than one (Svit has two, from
  // April), and the real one is whichever the team is actually in. Pick by
  // member count rather than assuming a single row exists.
  const { data: generals } = (await admin
    .from("chat_threads")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("kind", "group")
    .eq("name", "general")) as unknown as { data: Array<{ id: string }> | null };

  let threadId: string | null = null;
  let best = -1;
  for (const t of generals ?? []) {
    const { count } = (await admin
      .from("chat_thread_members")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", t.id)) as unknown as { count: number | null };
    if ((count ?? 0) > best) {
      best = count ?? 0;
      threadId = t.id;
    }
  }

  let postedToChat = false;
  if (threadId) {
    const res = await sendChatMessageAction(threadId, `${title}\n\n${body}`);
    postedToChat = res.ok;
    if (!res.ok) {
      console.error("[announce] chat post failed:", res.error);
    }
  }

  // notify is best-effort by design and never throws, so a failed email does
  // not cost the announcement. It also means we cannot count what was sent —
  // report what was ASKED for, not what Resend accepted.
  let emailed = 0;
  if (wantsEmail) {
    const { count } = (await admin
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organization_id)
      .eq("status", "active")) as unknown as { count: number | null };
    emailed = count ?? 0;
  }

  await notify({
    organizationId: membership.organization_id,
    audience: "org-wide",
    type: "announcement",
    title,
    body,
    href: threadId ? `/app/chat?thread=${threadId}` : "/app/notifications",
    channels: {
      inApp: true,
      // The chat post already pushed the thread. Only push from here when it
      // didn't, or everyone gets buzzed twice for one announcement.
      push: !postedToChat,
      email: wantsEmail,
    },
  });

  revalidatePath("/app/chat");
  revalidatePath("/field/chat");
  revalidatePath("/app/notifications");

  return {
    sent: { chat: postedToChat, emailed, email: wantsEmail, sentAt: Date.now() },
  };
}
