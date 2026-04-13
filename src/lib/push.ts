/**
 * Server-side Web Push helper.
 *
 * Sends push notifications to subscribed browsers via the Web Push protocol.
 * Requires VAPID keys — if they're missing, all sends silently no-op so the
 * app never crashes on unconfigured environments.
 */

import "server-only";
import webpush from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const isConfigured = !!VAPID_PUBLIC && !!VAPID_PRIVATE;

if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export function isPushConfigured(): boolean {
  return isConfigured;
}

interface PushPayload {
  title: string;
  body?: string;
  /** URL to open when the notification is clicked */
  href?: string;
  /** Icon URL — defaults to /icon-192.png */
  icon?: string;
}

/**
 * Send a push notification to a specific membership (all their subscribed
 * devices). Stale subscriptions (410 Gone) are automatically cleaned up.
 */
export async function sendPushToMembership(
  membershipId: string,
  payload: PushPayload,
): Promise<number> {
  if (!isConfigured) return 0;

  const db = createSupabaseAdminClient();
  const { data: subs } = await db
    .from("push_subscriptions" as never)
    .select("id, endpoint, keys_p256dh, keys_auth")
    .eq("membership_id", membershipId) as unknown as {
    data: Array<{
      id: string;
      endpoint: string;
      keys_p256dh: string;
      keys_auth: string;
    }> | null;
  };

  if (!subs || subs.length === 0) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    href: payload.href ?? "/",
    icon: payload.icon ?? "/icon-192.png",
  });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          body,
          { TTL: 60 * 60 }, // 1 hour
        );
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired — queue for cleanup
          staleIds.push(sub.id);
        } else {
          console.error("[push] sendNotification failed:", err);
        }
      }
    }),
  );

  // Clean up stale subscriptions
  if (staleIds.length > 0) {
    await (db
      .from("push_subscriptions" as never)
      .delete()
      .in("id", staleIds) as unknown as Promise<unknown>);
  }

  return sent;
}

/**
 * Send a push notification to ALL subscribed members of an org.
 * Used for org-wide notifications (null recipient).
 */
export async function sendPushToOrg(
  organizationId: string,
  payload: PushPayload,
): Promise<number> {
  if (!isConfigured) return 0;

  const db = createSupabaseAdminClient();
  const { data: subs } = await db
    .from("push_subscriptions" as never)
    .select("id, endpoint, keys_p256dh, keys_auth")
    .eq("organization_id", organizationId) as unknown as {
    data: Array<{
      id: string;
      endpoint: string;
      keys_p256dh: string;
      keys_auth: string;
    }> | null;
  };

  if (!subs || subs.length === 0) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    href: payload.href ?? "/",
    icon: payload.icon ?? "/icon-192.png",
  });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          body,
          { TTL: 60 * 60 },
        );
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          staleIds.push(sub.id);
        } else {
          console.error("[push] sendNotification failed:", err);
        }
      }
    }),
  );

  if (staleIds.length > 0) {
    await (db
      .from("push_subscriptions" as never)
      .delete()
      .in("id", staleIds) as unknown as Promise<unknown>);
  }

  return sent;
}
