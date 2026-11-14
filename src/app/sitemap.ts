import type { MetadataRoute } from "next";
import { HELP_ARTICLES } from "@/content/help";
import { LANDING_PAGES } from "@/content/landing";
import { SITE_URL } from "@/lib/seo";
import { listPublishedPosts } from "@/lib/blog";

// Rebuilt at most every 5 minutes, and at once when Holo publishes.
export const revalidate = 300;

/**
 * XML sitemap for the public marketing surface only. Auth-gated app routes and
 * per-recipient token pages are intentionally excluded (they're private / not
 * indexable). Keep this list in sync with the public (marketing) pages.
 *
 * /login and /signup are reachable but marked noindex — a sitemap entry for
 * a page that asks not to be indexed is a contradiction Search Console flags.
 * Help articles come straight from src/content/help, so a new guide is in
 * the sitemap the moment it ships.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Blog posts are published from Holo (app/api/integrations/holo/webhook),
  // which refreshes this sitemap on each one.
  const posts = await listPublishedPosts();
  const pages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
    ...LANDING_PAGES.map((l) => ({
      path: `/${l.slug}`,
      priority: 0.9,
      changeFrequency: "monthly" as const,
    })),
    { path: "/help", priority: 0.7, changeFrequency: "weekly" },
    ...HELP_ARTICLES.map((a) => ({
      path: `/help/${a.slug}`,
      priority: 0.6,
      changeFrequency: "monthly" as const,
    })),
    { path: "/blog", priority: 0.7, changeFrequency: "weekly" },
    { path: "/security", priority: 0.6, changeFrequency: "monthly" },
    { path: "/privacy", priority: 0.4, changeFrequency: "yearly" },
    { path: "/terms", priority: 0.4, changeFrequency: "yearly" },
  ];

  return [
    ...pages.map((p) => ({
      url: `${SITE_URL}${p.path}`,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
    })),
    ...posts.map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: p.updated_at,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
