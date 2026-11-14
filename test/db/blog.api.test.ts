/**
 * Holo publishes to the Sollos blog (2026-11-13).
 *
 * Signed deliveries posted to the real webhook route, against the real
 * database; then the blog pages and the sitemap rendered from what was
 * saved. Holo's image CDN is stood in for; the test stack has no storage
 * server, so image copies fail, and the post must keep the original address.
 */
import { createHmac } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

const SECRET = "holo-test-secret";
let api: Api;
let restoreEnv: () => void;
const savedSecret = process.env.HOLO_WEBHOOK_SECRET;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.HOLO_WEBHOOK_SECRET = SECRET;
}, 240_000);

afterAll(async () => {
  if (savedSecret === undefined) delete process.env.HOLO_WEBHOOK_SECRET;
  else process.env.HOLO_WEBHOOK_SECRET = savedSecret;
  restoreEnv?.();
  await api?.stop();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  request.after = [];
});

let n = 0;
function article(over: Record<string, unknown> = {}) {
  n++;
  return {
    event: "article.published",
    deliveryId: `dlv_${n}`,
    brand: { name: "Sollos" },
    article: {
      title: `How to price a deep clean ${n}`,
      slug: `how-to-price-a-deep-clean-${n}`,
      excerpt: "Price it by the room, not the hour.",
      contentHtml: `<h1>Pricing</h1><p onclick="x()">Start with the rooms.</p><script>alert(1)</script><img src="https://cdn.tryholo.test/a.png" alt="Kitchen">`,
      contentMarkdown: "# Pricing\n\nStart with the rooms.",
      metaTitle: "Deep clean pricing guide",
      metaDescription: "A simple way to price deep cleans.",
      featuredImage: { url: "https://cdn.tryholo.test/hero.png", alt: "A clean kitchen" },
      images: [{ url: "https://cdn.tryholo.test/a.png", alt: "Kitchen" }],
      publishedAt: "2026-11-13T15:00:00.000Z",
      isRepublish: false,
      ...over,
    },
  };
}

async function deliver(payload: unknown, opts: { sign?: "hmac" | "bearer" | "wrong" | "none"; raw?: string } = {}) {
  const { POST } = await import("@/app/api/integrations/holo/webhook/route");
  const body = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" };
  const sign = opts.sign ?? "hmac";
  if (sign === "hmac") headers["x-holo-signature"] = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  if (sign === "bearer") headers.authorization = `Bearer ${SECRET}`;
  if (sign === "wrong") headers["x-holo-signature"] = "sha256=" + createHmac("sha256", "not-it").update(body).digest("hex");
  const res = await POST(new Request("https://sollos3.test/api/integrations/holo/webhook", { method: "POST", headers, body }) as never);
  await settle();
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const post = async (slug: string) =>
  (await api.sql<{ title: string; content_html: string; meta_title: string; featured_image_url: string; last_delivery_id: string }>(
    "select title, content_html, meta_title, featured_image_url, last_delivery_id from public.blog_posts where slug = $1",
    [slug],
  ))[0];

describe.skipIf(!hasPostgrest)("Holo → the Sollos blog", { timeout: 90_000 }, () => {
  it("publishes a signed article, cleaned, and shows it on the blog, its page and the sitemap", async () => {
    // Holo's CDN answers; storage isn't there in the test stack, so the copy fails.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("cdn.tryholo.test")) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
      return realFetch(input, init);
    }) as typeof fetch;

    const a = article();
    const res = await deliver(a);
    expect(res, api.log()).toEqual({ status: 200, json: { ok: true, slug: a.article.slug } });

    const row = await post(a.article.slug);
    expect(row.title).toBe(a.article.title);
    expect(row.meta_title).toBe("Deep clean pricing guide");
    expect(row.content_html).toContain("<h2>Pricing</h2>");
    expect(row.content_html).toContain("<p>Start with the rooms.</p>");
    expect(row.content_html).not.toMatch(/script|onclick/);
    // The image couldn't be copied here, so the original address stays and nothing broke.
    expect(row.featured_image_url).toBe("https://cdn.tryholo.test/hero.png");

    const { default: BlogPostPage } = await import("@/app/blog/[slug]/page");
    const page = renderToStaticMarkup(await BlogPostPage({ params: Promise.resolve({ slug: a.article.slug }) }));
    expect(page).toContain(a.article.title);
    expect(page).toContain("Start with the rooms.");
    expect(page).not.toMatch(/<script>alert/);
    expect(page).toContain('"@type":"BlogPosting"');

    const { default: BlogIndexPage } = await import("@/app/blog/page");
    const index = renderToStaticMarkup(await BlogIndexPage());
    expect(index).toContain(`href="/blog/${a.article.slug}"`);

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith(`/blog/${a.article.slug}`))).toBe(true);
    expect(urls.some((u) => u.endsWith("/blog"))).toBe(true);
  });

  it("an edit in Holo updates the same post, and a repeat delivery changes nothing else", async () => {
    const a = article();
    await deliver(a, { sign: "bearer" });
    const edited = { ...a, event: "article.updated", deliveryId: "dlv_edit", article: { ...a.article, title: "Pricing a deep clean, revised" } };
    expect((await deliver(edited)).status).toBe(200);
    expect((await deliver(edited)).status).toBe(200); // Holo retrying
    const rows = await api.sql<{ title: string; last_delivery_id: string }>(
      "select title, last_delivery_id from public.blog_posts where slug = $1",
      [a.article.slug],
    );
    expect(rows).toEqual([{ title: "Pricing a deep clean, revised", last_delivery_id: "dlv_edit" }]);
  });

  it("refuses unsigned and forged deliveries, and says why for unusable ones", async () => {
    const a = article();
    expect((await deliver(a, { sign: "none" })).status).toBe(401);
    expect((await deliver(a, { sign: "wrong" })).status).toBe(401);
    expect(await post(a.article.slug)).toBeUndefined();

    expect((await deliver(null, { raw: "{not json" })).status).toBe(400);
    expect((await deliver(article({ contentHtml: "<script>only</script>", contentMarkdown: null }))).status).toBe(400);
    const ignored = await deliver({ event: "article.deleted", article: { title: "x" } });
    expect(ignored).toEqual({ status: 200, json: { ok: true, ignored: true } });
  });

  it("cleans again on display, so a row written some other way can't put a script on the page", async () => {
    await api.sql(
      `insert into public.blog_posts (slug, title, content_html) values ('planted', 'Planted', '<p>ok</p><script>alert(1)</script><a href="javascript:x()">x</a>')`,
    );
    const { default: BlogPostPage } = await import("@/app/blog/[slug]/page");
    const page = renderToStaticMarkup(await BlogPostPage({ params: Promise.resolve({ slug: "planted" }) }));
    expect(page).toContain("<p>ok</p>");
    expect(page).not.toMatch(/<script>alert|javascript:/);
  });

  it("an unknown slug is a 404, not a page", async () => {
    const { default: BlogPostPage } = await import("@/app/blog/[slug]/page");
    await expect(BlogPostPage({ params: Promise.resolve({ slug: "never-published" }) })).rejects.toThrow(/not found/);
    await expect(BlogPostPage({ params: Promise.resolve({ slug: "../etc" }) })).rejects.toThrow(/not found/);
  });
});
