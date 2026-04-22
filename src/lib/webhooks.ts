/**
 * Outbound webhook dispatcher with delivery tracking and retries.
 *
 * When a mutation happens (booking created, invoice paid, etc.), the
 * server action calls `dispatchWebhookEvent()`. This function:
 *
 *   1. Looks up active webhook subscriptions for the org + event type
 *   2. POSTs the payload to each registered URL with HMAC-SHA256 signature
 *   3. Logs every delivery attempt to `webhook_deliveries` for debugging
 *   4. Retries failed deliveries with exponential backoff (up to 3 attempts)
 *
 * Each delivery is signed with `X-Sollos-Signature` so the recipient
 * can verify authenticity.
 */

import "server-only";
import { createHmac, randomUUID } from "node:crypto";
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

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000]; // exponential-ish backoff

/**
 * Dispatch a webhook event. Logs every attempt. Retries on failure.
 * Never throws — errors are captured in the delivery log.
 */
export async function dispatchWebhookEvent(
  orgId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    // Reads from `webhooks` (the table the settings UI writes to). The
    // events[] array contains zero-or-more event-type strings; we match
    // with the array-contains operator. is_active gates delivery.
    const { data: rows } = (await admin
      .from("webhooks" as never)
      .select("id, url, secret")
      .eq("organization_id" as never, orgId as never)
      .contains("events" as never, [eventType] as never)
      .eq("is_active" as never, true as never)) as unknown as {
      data: Array<{ id: string; url: string; secret: string }> | null;
    };

    if (!rows || rows.length === 0) return;

    const eventId = randomUUID();
    const timestamp = new Date().toISOString();

    const body = JSON.stringify({
      id: eventId,
      event: eventType,
      data: payload,
      timestamp,
    });

    // Normalize to the shape the delivery helper expects.
    const subs = rows.map((r) => ({
      id: r.id,
      target_url: r.url,
      secret: r.secret,
    }));

    const deliveries = subs.map((sub) =>
      deliverWithRetries(admin, sub, body, eventId, orgId, eventType),
    );

    await Promise.allSettled(deliveries);
  } catch (err) {
    console.error("[webhook] dispatch error:", err);
  }
}

/**
 * Deliver a single webhook with up to MAX_RETRIES retries.
 * Each attempt is logged to `webhook_deliveries`.
 */
async function deliverWithRetries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  sub: { id: string; target_url: string; secret: string },
  body: string,
  eventId: string,
  orgId: string,
  eventType: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { success, statusCode, errorMessage, durationMs } = await attemptDelivery(
      sub,
      body,
    );

    // Log the attempt
    await logDelivery(admin, {
      organization_id: orgId,
      webhook_id: sub.id,
      event_id: eventId,
      event_type: eventType,
      target_url: sub.target_url,
      attempt,
      status_code: statusCode,
      success,
      error_message: errorMessage,
      duration_ms: durationMs,
      payload_size: body.length,
    }).catch((err) =>
      console.error("[webhook] failed to log delivery:", err),
    );

    // Update the webhook row's denormalized status so the settings UI
    // shows recent activity. Fire-and-forget.
    admin
      .from("webhooks" as never)
      .update({
        last_triggered_at: new Date().toISOString(),
        last_status_code: statusCode,
      } as never)
      .eq("id" as never, sub.id as never)
      .then(
        () => {},
        (err: unknown) =>
          console.error("[webhook] failed to touch webhook row:", err),
      );

    if (success) return; // done

    // Don't retry on 4xx — those are client errors (bad endpoint, auth, etc.)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      console.warn(
        `[webhook] sub ${sub.id} returned ${statusCode}, not retrying`,
      );
      return;
    }

    // Wait before retrying (except on last attempt)
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 30_000;
      await sleep(delay);
    }
  }

  console.error(
    `[webhook] sub ${sub.id} failed after ${MAX_RETRIES} attempts for event ${eventId}`,
  );
}

/**
 * Single delivery attempt. Returns status info for logging.
 */
async function attemptDelivery(
  sub: { id: string; target_url: string; secret: string },
  body: string,
): Promise<{
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
  durationMs: number;
}> {
  const start = Date.now();

  try {
    const signature = createHmac("sha256", sub.secret)
      .update(body)
      .digest("hex");

    const res = await fetch(sub.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sollos-Signature": `sha256=${signature}`,
        "User-Agent": "Sollos-Webhook/1.0",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const durationMs = Date.now() - start;
    const success = res.ok; // 2xx

    return {
      success,
      statusCode: res.status,
      errorMessage: success ? null : `${res.status} ${res.statusText}`,
      durationMs,
    };
  } catch (err) {
    return {
      success: false,
      statusCode: null,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Insert a delivery log row.
 */
async function logDelivery(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  row: {
    organization_id: string;
    webhook_id: string;
    event_id: string;
    event_type: string;
    target_url: string;
    attempt: number;
    status_code: number | null;
    success: boolean;
    error_message: string | null;
    duration_ms: number;
    payload_size: number;
  },
) {
  await admin
    .from("webhook_deliveries" as never)
    .insert(row as never);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
