import sanitizeHtml from "sanitize-html";

/**
 * The Sollos blog (2026-11-13): articles written in Holo (tryholo.ai),
 * delivered by its webhook (app/api/integrations/holo/webhook), shown at
 * /blog. This file holds the parts that must agree everywhere: what HTML an
 * article may contain, what a slug looks like, and how posts are read.
 */

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_html: string;
  meta_title: string | null;
  meta_description: string | null;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  published_at: string;
  updated_at: string;
};

export type BlogPostSummary = Pick<
  BlogPost,
  "slug" | "title" | "excerpt" | "featured_image_url" | "featured_image_alt" | "published_at" | "updated_at"
>;

/**
 * What an article may contain. The text comes from an outside service and is
 * shown on sollos3.com, so anything that could run code is removed: scripts,
 * styles, iframes, forms, event handlers (onclick=…), and javascript: or
 * data: links. Headings, lists, links, images, tables, quotes and code stay.
 * The page has its own <h1> (the title), so an <h1> inside the article
 * becomes an <h2>.
 */
const ARTICLE_RULES: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "h5", "h6", "p", "br", "hr",
    "strong", "b", "em", "i", "u", "s", "mark", "small", "sub", "sup",
    "blockquote", "ul", "ol", "li",
    "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "code", "pre", "span",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    ol: ["start"],
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    h1: "h2",
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const external = /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?sollos3\.com(\/|$)/i.test(href);
      return {
        tagName,
        attribs: {
          ...attribs,
          ...(external ? { rel: "noopener noreferrer", target: "_blank" } : {}),
        },
      };
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
  },
};

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, ARTICLE_RULES).trim();
}

/** Plain text only (titles, excerpts, meta): every tag removed. */
export function plainText(value: string | null | undefined, max = 500): string | null {
  if (!value) return null;
  const text = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "Best Cleaning Checklist 2026!" → "best-cleaning-checklist-2026". Null when nothing usable is left. */
export function blogSlug(value: string | null | undefined): string | null {
  const slug = (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || null;
}

type Admin = ReturnType<typeof import("@/lib/supabase/admin").createSupabaseAdminClient>;

async function admin(): Promise<Admin> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  return createSupabaseAdminClient();
}

/** Newest first. Up to 200: the blog index, the sitemap. */
export async function listPublishedPosts(limit = 200): Promise<BlogPostSummary[]> {
  const db = await admin();
  const { data, error } = (await db
    .from("blog_posts" as never)
    .select("slug, title, excerpt, featured_image_url, featured_image_alt, published_at, updated_at")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(limit)) as unknown as { data: BlogPostSummary[] | null; error: { message: string } | null };
  if (error) {
    console.error("[blog] list failed:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const db = await admin();
  const { data, error } = (await db
    .from("blog_posts" as never)
    .select(
      "id, slug, title, excerpt, content_html, meta_title, meta_description, featured_image_url, featured_image_alt, published_at, updated_at",
    )
    .eq("slug", slug)
    .lte("published_at", new Date().toISOString())
    .maybeSingle()) as unknown as { data: BlogPost | null; error: { message: string } | null };
  if (error) {
    console.error("[blog] read failed:", error.message);
    return null;
  }
  return data;
}
