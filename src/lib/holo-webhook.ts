import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { blogSlug, plainText, sanitizeArticleHtml } from "@/lib/blog";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Holo's SEO webhook → a Sollos blog post (2026-11-13).
 *
 * Holo (tryholo.ai) POSTs an approved article to
 * /api/integrations/holo/webhook (docs.tryholo.ai/seo/seo-webhooks.md):
 *   events   article.published, article.updated
 *   auth     HMAC-SHA256 over the raw body, `X-Holo-Signature: sha256=<hex>`,
 *            or `Authorization: Bearer <secret>`, whichever is chosen in Holo
 *   retries  up to 8 on 5xx / 408 / 429 / timeout (10 s); other 4xx are final
 *
 * The secret is HOLO_WEBHOOK_SECRET. A post is keyed by its slug, so a retry
 * or an update rewrites the same row instead of adding another.
 */

/** Constant-time check of either form Holo can sign with. */
export function verifyHoloRequest(args: {
  rawBody: string;
  signatureHeader: string | null;
  authorizationHeader: string | null;
  secret: string;
}): boolean {
  const { rawBody, signatureHeader, authorizationHeader, secret } = args;
  if (!secret) return false;
  const same = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  if (signatureHeader) {
    const given = signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    if (same(given, expected)) return true;
  }
  if (authorizationHeader) {
    const token = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
    if (same(token, secret)) return true;
  }
  return false;
}

const image = z.object({ url: z.string().url().max(2000), alt: z.string().max(500).nullish() });

export const HoloPayload = z.object({
  event: z.string(),
  deliveryId: z.string().max(200).nullish(),
  brand: z.unknown().optional(),
  article: z
    .object({
      title: z.string().min(1).max(300),
      slug: z.string().max(300).nullish(),
      excerpt: z.string().max(5000).nullish(),
      contentHtml: z.string().max(500_000).nullish(),
      contentMarkdown: z.string().max(500_000).nullish(),
      metaTitle: z.string().max(300).nullish(),
      metaDescription: z.string().max(1000).nullish(),
      featuredImage: z.union([image, z.string().url().max(2000)]).nullish(),
      images: z.array(image).max(50).nullish(),
      publishedAt: z.string().nullish(),
      isRepublish: z.boolean().nullish(),
    })
    .passthrough(),
});
export type HoloPayload = z.infer<typeof HoloPayload>;

export const HANDLED_EVENTS = new Set(["article.published", "article.updated"]);

/** Markdown fallback when Holo sends no HTML: paragraphs only, escaped. Rare; Holo sends both. */
function markdownToBasicHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      const h = /^(#{2,6})\s+(.*)$/.exec(t);
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      if (/^#\s+/.test(t)) return `<h2>${esc(t.replace(/^#\s+/, ""))}</h2>`;
      return t ? `<p>${esc(t).replace(/\n/g, "<br>")}</p>` : "";
    })
    .join("\n");
}

function brandName(brand: unknown): string | null {
  if (typeof brand === "string") return brand.slice(0, 200);
  if (brand && typeof brand === "object" && "name" in brand) {
    const n = (brand as { name?: unknown }).name;
    return typeof n === "string" ? n.slice(0, 200) : null;
  }
  return null;
}

export type SavedPost = { slug: string; featured: string | null; imageUrls: string[] };

/**
 * Write the article. Throws on a database failure so the route answers 500
 * and Holo retries; a retry rewrites the same row.
 */
export async function saveHoloArticle(payload: HoloPayload): Promise<SavedPost | { error: string }> {
  const a = payload.article;
  const slug = blogSlug(a.slug) ?? blogSlug(a.title);
  if (!slug) return { error: "The article has no usable slug or title." };

  const html = sanitizeArticleHtml(a.contentHtml ?? (a.contentMarkdown ? markdownToBasicHtml(a.contentMarkdown) : ""));
  if (!html) return { error: "The article has no content." };

  const featured =
    typeof a.featuredImage === "string" ? { url: a.featuredImage, alt: null } : a.featuredImage ?? null;
  const featuredUrl = featured && /^https:\/\//i.test(featured.url) ? featured.url : null;
  const publishedAt = a.publishedAt && !Number.isNaN(Date.parse(a.publishedAt)) ? new Date(a.publishedAt).toISOString() : null;

  const row = {
    slug,
    title: plainText(a.title, 300) ?? slug,
    excerpt: plainText(a.excerpt, 600),
    content_html: html,
    meta_title: plainText(a.metaTitle, 300),
    meta_description: plainText(a.metaDescription, 400),
    featured_image_url: featuredUrl,
    featured_image_alt: plainText(featured?.alt ?? null, 300),
    ...(publishedAt ? { published_at: publishedAt } : {}),
    source: "holo",
    source_brand: brandName(payload.brand),
    last_delivery_id: payload.deliveryId ?? null,
  };

  const db = createSupabaseAdminClient();
  const { error } = (await db
    .from("blog_posts" as never)
    .upsert(row as never, { onConflict: "slug" })) as unknown as { error: { message: string } | null };
  if (error) throw new Error(`blog_posts: ${error.message}`);

  const inline = [...html.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"/gi)].map((m) => m[1]);
  return { slug, featured: featuredUrl, imageUrls: [...new Set(inline)] };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * Copy an article's images into the public blog-media bucket and point the
 * post at the copies, so it keeps its pictures if Holo moves or deletes them.
 * Runs after the webhook has answered (Holo gives it 10 seconds). Any image
 * that can't be copied keeps its Holo address; nothing here fails the post.
 */
export async function copyArticleImages(saved: SavedPost): Promise<{ copied: number; kept: number }> {
  const { assertSafeOutboundTarget } = await import("@/lib/url-safety");
  const db = createSupabaseAdminClient();
  const urls = [...new Set([saved.featured, ...saved.imageUrls].filter(Boolean) as string[])];
  const moved = new Map<string, string>();
  let kept = 0;

  for (const [i, url] of urls.entries()) {
    try {
      if (url.includes("/storage/v1/object/public/blog-media/")) continue; // already ours
      // Inline addresses come from cleaned HTML, where & is written &amp;.
      const safe = await assertSafeOutboundTarget(url.replace(/&amp;/g, "&"));
      if (!safe.ok) throw new Error(safe.reason);
      const res = await fetch(safe.url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = IMAGE_TYPES[type];
      if (!res.ok || !ext) throw new Error(`HTTP ${res.status} ${type}`);
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("too large");
      const path = `${saved.slug}/${i}-${Date.now().toString(36)}.${ext}`;
      const { error } = await db.storage.from("blog-media").upload(path, bytes, { contentType: type, upsert: true });
      if (error) throw new Error(error.message);
      moved.set(url, db.storage.from("blog-media").getPublicUrl(path).data.publicUrl);
    } catch (err) {
      kept++;
      console.warn(`[holo] kept the original image for /blog/${saved.slug}:`, err instanceof Error ? err.message : err);
    }
  }
  if (moved.size === 0) return { copied: 0, kept };

  const { data: post } = (await db
    .from("blog_posts" as never)
    .select("content_html, featured_image_url")
    .eq("slug", saved.slug)
    .maybeSingle()) as unknown as { data: { content_html: string; featured_image_url: string | null } | null };
  if (!post) return { copied: 0, kept };
  let html = post.content_html;
  for (const [from, to] of moved) html = html.split(`src="${from}"`).join(`src="${to}"`);
  const featured = post.featured_image_url && moved.get(post.featured_image_url);
  await db
    .from("blog_posts" as never)
    .update({ content_html: html, ...(featured ? { featured_image_url: featured } : {}) } as never)
    .eq("slug", saved.slug);
  return { copied: moved.size, kept };
}
