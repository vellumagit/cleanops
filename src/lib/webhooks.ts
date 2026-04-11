/**
 * Outbound webhook dispatcher.
 *
 * When a mutation happens (booking created, invoice paid, etc.), the
 * server action calls `dispatchWebhookEvent()` fire-and-forget. This
 * function looks up any active webhook subscriptions for that org + event
 * type and POSTs the payload to each registered URL.
 *
 * Each delivery is signed with an HMAC-SHA256 signature in the
 * `X-CleanOps-Signature` header so the recipient can verify authenticity.
 */

import "server-only";
import { createHmac } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type WebhookEventType =
  | "booking.created"
  | "booking.updated"
  | "booking.cancelled"
  | "booking.completed"
  | "client.created"
  | "client.updated"
  | "estimate.created"
  | "estimate.updated"
  | "invoice.created"
  | "invoice.updated"
  | "invoice.paid";

/**
 * Fire-and-forget: look up subscriptions and POST to each target URL.
 * Failures are logged but never bubble up to the caller.
 */
export async function dispatchWebhookEvent(
  orgId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: subs } = await admin
      .from("webhook_subscriptions" as never)
      .select("id, target_url, secret")
      .eq("organization_id", orgId)
      .eq("event_type", eventType)
      .eq("active", true);

    if (!subs || subs.length === 0) return;

    const body = JSON.stringify({
      event: eventType,
      data: payload,
      timestamp: new Date().toISOString(),
    });

    const deliveries = (subs as unknown as Array<{ id: string; target_url: string; secret: string }>).map(
      async (sub) => {
        try {
          const signature = createHmac("sha256", sub.secret)
            .update(body)
            .digest("hex");

          const res = await fetch(sub.target_url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CleanOps-Signature": `sha256=${signature}`,
              "User-Agent": "CleanOps-Webhook/1.0",
            },
            body,
            signal: AbortSignal.timeout(10_000), // 10s timeout
          });

          if (!res.ok) {
            console.warn(
              `[webhook] delivery failed for sub ${sub.id}: ${res.status} ${res.statusText}`,
            );
          }
        } catch (err) {
          console.error(`[webhook] delivery error for sub ${sub.id}:`, err);
        }
      },
    );

    await Promise.allSettled(deliveries);
  } catch (err) {
    console.error("[webhook] dispatch error:", err);
  }
}
