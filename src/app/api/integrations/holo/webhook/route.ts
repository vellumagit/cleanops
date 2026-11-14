/**
 * POST /api/integrations/holo/webhook — Holo publishes a blog post.
 *
 * Holo (tryholo.ai) sends each approved article here when it is published
 * or edited (lib/holo-webhook.ts has the contract). The post appears at
 * /blog/<slug> straight away; its images are copied into Sollos's storage
 * after the response, because Holo waits only 10 seconds.
 *
 * Answers: 200 saved (or an event we don't handle, so Holo doesn't retry
 * it), 401 bad signature, 400 a payload that can't become a post (final:
 * Holo doesn't retry 4xx), 500 our failure (Holo retries), 503 not set up.
 *
 * Setup: in Holo, SEO → Connect your website → Webhook, with this URL and
 * HMAC signing; the same secret goes in Vercel as HOLO_WEBHOOK_SECRET.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { rateLimitByIp } from "@/lib/rate-limit-helpers";
import {
  copyArticleImages,
  HANDLED_EVENTS,
  HoloPayload,
  saveHoloArticle,
  verifyHoloRequest,
} from "@/lib/holo-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = await rateLimitByIp(req, "holo-webhook", 120, 60_000);
  if (limited) return limited;

  const secret = process.env.HOLO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[holo] HOLO_WEBHOOK_SECRET is not set; refusing the delivery");
    return NextResponse.json({ error: "Blog publishing isn't set up yet." }, { status: 503 });
  }

  // The raw body, exactly as sent: the HMAC covers these bytes.
  const rawBody = await req.text();
  if (
    !verifyHoloRequest({
      rawBody,
      signatureHeader: req.headers.get("x-holo-signature"),
      authorizationHeader: req.headers.get("authorization"),
      secret,
    })
  ) {
    console.warn("[holo] signature check failed");
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  enterFailClosed();

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "The body isn't JSON." }, { status: 400 });
  }
  const event = (json as { event?: unknown } | null)?.event;
  if (typeof event !== "string" || !HANDLED_EVENTS.has(event)) {
    console.log(`[holo] ignored event ${String(event)}`);
    return NextResponse.json({ ok: true, ignored: true });
  }
  const parsed = HoloPayload.safeParse(json);
  if (!parsed.success) {
    console.warn("[holo] payload rejected:", parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return NextResponse.json({ error: "The article is missing fields Sollos needs (a title and content)." }, { status: 400 });
  }

  const saved = await saveHoloArticle(parsed.data);
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });

  revalidatePath("/blog");
  revalidatePath(`/blog/${saved.slug}`);
  revalidatePath("/sitemap.xml");
  console.log(`[holo] ${event} → /blog/${saved.slug} (delivery ${parsed.data.deliveryId ?? "?"})`);

  after(async () => {
    try {
      const r = await copyArticleImages(saved);
      if (r.copied) revalidatePath(`/blog/${saved.slug}`);
    } catch (err) {
      console.error(`[holo] image copy for /blog/${saved.slug} failed:`, err);
    }
  });

  return NextResponse.json({ ok: true, slug: saved.slug });
}
