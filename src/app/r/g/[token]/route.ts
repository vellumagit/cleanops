/**
 * Google review click tracker + redirect.
 *
 *   GET /r/g/<token>  →  302 to org's google_review_url
 *
 * The customer's email contains this URL instead of the raw Google
 * review link. When they click:
 *   1. Look up the client by gbp_redirect_token
 *   2. Stamp gbp_clicked_at + flip state to "clicked" (no more email)
 *   3. 302 to the org's configured google_review_url
 *
 * Click = our stop signal. We can't confirm the customer actually
 * leaves a review (the Business Profile API gate is a separate ticket),
 * but they engaged with our ask, so we stop nudging.
 *
 * Idempotent on repeat clicks — same token, same stamp, same redirect.
 *
 * Failure modes:
 *   - Unknown token  → 404 + plain HTML "link not recognized" page
 *   - Org has no google_review_url → fallback to a friendly Sollos
 *     "thank you" page so the customer at least sees something nice
 */

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 8 || token.length > 64) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Rate-limit by IP. Without this, an attacker iterating
  // gbp_redirect_token guesses could silently flip every customer's
  // gbp_clicked_at across the customer base — same defense every
  // other public token route applies.
  const rl = await checkIpRateLimit("gbp-redirect", 30, 60_000);
  if (!rl.allowed) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Too many requests</title><body style="font-family:system-ui;padding:40px;text-align:center"><p>Too many requests. Try again shortly.</p></body>`,
      { status: 429, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: client } = (await admin
    .from("clients")
    .select(
      "id, organization_id, gbp_review_state, organization:organizations ( name, google_review_url )",
    )
    .eq("gbp_redirect_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      gbp_review_state: string;
      organization: { name: string; google_review_url: string | null } | null;
    } | null;
  };

  if (!client) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Flip state to "clicked" only if we're still in an asking state.
  // Already-clicked / reviewed / opted_out / lapsed are no-ops on the
  // state column but we still set the latest gbp_clicked_at so the
  // owner can see "they came back".
  const shouldFlipState = ["never_asked", "pending"].includes(
    client.gbp_review_state,
  );
  await admin
    .from("clients")
    .update({
      gbp_clicked_at: new Date().toISOString(),
      ...(shouldFlipState ? { gbp_review_state: "clicked" } : {}),
    } as never)
    .eq("id", client.id);

  const target = client.organization?.google_review_url;
  if (!target) {
    // Org never set their Google review URL — render a friendly
    // fallback so the customer doesn't land on a broken page.
    return new Response(
      thankYouHtml(client.organization?.name ?? "Our team"),
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }

  // Vercel/Next will throw a NEXT_REDIRECT — caller doesn't need to catch.
  redirect(target);
}

function notFoundHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Link not found</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 24px;color:#27272a;line-height:1.5}h1{font-size:20px;margin:0 0 12px}p{color:#71717a}</style>
</head><body>
<h1>This link is no longer active</h1>
<p>The review link you followed doesn't match an active customer record. If you meant to leave us a review, please contact us directly and we'll send you a fresh link.</p>
</body></html>`;
}

function thankYouHtml(orgName: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Thank you</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 24px;color:#27272a;line-height:1.5;text-align:center}h1{font-size:24px;margin:0 0 12px}p{color:#71717a}</style>
</head><body>
<h1>Thank you 💚</h1>
<p>${escape(orgName)} appreciates you taking the time. They haven't connected a public review platform yet — please reach out directly to share your feedback.</p>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
