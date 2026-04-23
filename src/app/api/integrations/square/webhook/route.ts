import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/square";

/**
 * Square webhook receiver.
 *
 * Square posts events (payment.created, payment.updated, refund.created,
 * etc.) to this URL. We:
 *
 *   1. Verify the HMAC signature against SQUARE_WEBHOOK_SIGNATURE_KEY —
 *      reject anything unsigned or with a wrong signature.
 *   2. Idempotency: skip events we've already recorded in
 *      `integration_events`.
 *   3. On payment.updated with status=COMPLETED, look up the matching
 *      Sollos invoice via square_order_id, then insert a row into
 *      invoice_payments. The `invoice_payments_sync_totals` trigger will
 *      flip the invoice's status automatically.
 *
 * We return 200 for all "processed" outcomes (including "already seen")
 * so Square stops retrying. Only return 4xx on verification failure so
 * a misconfigured key shows up loudly in the dashboard.
 */
export async function POST(request: NextRequest) {
  // The raw body is required for HMAC verification — we read text()
  // before JSON.parse'ing anything.
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");

  // The URL Square posted to — must exactly match what's registered in
  // Square's webhook config. We reconstruct it from the request; setting
  // NEXT_PUBLIC_SITE_URL is a safer anchor in case of proxy rewrites.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const notificationUrl = `${siteUrl}/api/integrations/square/webhook`;

  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  if (
    !verifyWebhookSignature({
      notificationUrl,
      rawBody,
      signature,
    })
  ) {
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 401 },
    );
  }

  let event: {
    event_id?: string;
    merchant_id?: string;
    type?: string;
    data?: {
      type?: string;
      id?: string;
      object?: {
        payment?: {
          id?: string;
          status?: string;
          order_id?: string;
          total_money?: { amount?: number; currency?: string };
          receipt_url?: string;
          card_details?: { card?: { last_4?: string } };
          created_at?: string;
        };
      };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = event.event_id;
  const eventType = event.type ?? "unknown";
  const merchantId = event.merchant_id ?? null;

  if (!eventId) {
    return NextResponse.json({ ok: true, ignored: "no_event_id" });
  }

  const admin = createSupabaseAdminClient();

  // Idempotency guard: if we've already logged this event, drop.
  const { data: existing } = (await admin
    .from("integration_events" as never)
    .select("id")
    .eq("provider" as never, "square" as never)
    .eq("provider_event_id" as never, eventId as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };

  if (existing) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Resolve org by merchant_id so we can scope writes correctly.
  const { data: conn } = (await admin
    .from("integration_connections" as never)
    .select("organization_id")
    .eq("provider" as never, "square" as never)
    .eq("external_account_id" as never, merchantId as never)
    .maybeSingle()) as unknown as {
    data: { organization_id: string } | null;
  };
  const orgId = conn?.organization_id ?? null;

  // Record the event up front so we're idempotent even if the handler
  // below partially fails. `integration_events_provider_event_uidx` has
  // a UNIQUE on (provider, provider_event_id).
  await admin.from("integration_events" as never).insert({
    organization_id: orgId,
    provider: "square",
    provider_event_id: eventId,
    event_type: eventType,
    payload: event,
  } as never);

  // We only care about a narrow slice of events for now: completed
  // payments. Everything else is recorded and ignored.
  if (
    eventType === "payment.updated" ||
    eventType === "payment.created"
  ) {
    const payment = event.data?.object?.payment;
    if (
      payment?.status === "COMPLETED" &&
      payment.order_id &&
      payment.total_money?.amount != null &&
      orgId
    ) {
      await recordCompletedPayment(admin, {
        orgId,
        orderId: payment.order_id,
        amountCents: payment.total_money.amount,
        paymentId: payment.id ?? eventId,
        last4: payment.card_details?.card?.last_4 ?? null,
        receivedAt: payment.created_at ?? new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * Find the Sollos invoice that this Square payment is for (match on
 * square_order_id) and insert an invoice_payments row. The DB trigger
 * invoice_payments_sync_totals picks it up and flips the invoice's
 * status.
 */
async function recordCompletedPayment(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  args: {
    orgId: string;
    orderId: string;
    amountCents: number;
    paymentId: string;
    last4: string | null;
    receivedAt: string;
  },
): Promise<void> {
  const { data: invoice } = (await admin
    .from("invoices" as never)
    .select("id, organization_id, status, voided_at")
    .eq("square_order_id" as never, args.orderId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      status: string;
      voided_at: string | null;
    } | null;
  };

  if (!invoice) {
    console.error(
      "[square/webhook] payment had no matching invoice; order_id=",
      args.orderId,
    );
    return;
  }
  if (invoice.organization_id !== args.orgId) {
    // Cross-tenant guard — the merchant + invoice's orgs must agree.
    console.error(
      "[square/webhook] org mismatch on payment; dropping. order_id=",
      args.orderId,
    );
    return;
  }
  if (invoice.voided_at) {
    // Payment came in on a voided invoice. Don't record — would confuse
    // the trigger. Real-world: the org voided right as the client paid.
    // Operator handles the refund out of band.
    console.warn(
      "[square/webhook] payment on a voided invoice; dropping. invoice_id=",
      invoice.id,
    );
    return;
  }

  // Defensive: skip if we've already inserted a payment with the same
  // provider_payment_id (Square can retry the same payment.updated event
  // and our own idempotency guard above covers events — this covers
  // same-payment-via-different-events).
  const { data: dup } = (await admin
    .from("invoice_payments" as never)
    .select("id")
    .eq("provider" as never, "square" as never)
    .eq("provider_payment_id" as never, args.paymentId as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (dup) return;

  await admin.from("invoice_payments" as never).insert({
    organization_id: invoice.organization_id,
    invoice_id: invoice.id,
    amount_cents: args.amountCents,
    method: "card",
    reference: args.last4 ? `card ending ${args.last4}` : null,
    notes: null,
    received_at: args.receivedAt,
    provider: "square",
    provider_payment_id: args.paymentId,
  } as never);
}
