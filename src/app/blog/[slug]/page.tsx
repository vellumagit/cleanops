import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { HelpCta, MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { getPublishedPost, postDescription, sanitizeArticleHtml } from "@/lib/blog";
import { breadcrumbJsonLd, SITE_URL } from "@/lib/seo";
import { LANDING_PAGES } from "@/content/landing";

/**
 * One blog article (2026-11-13). Published from Holo by webhook, which
 * refreshes this page on publish and on every edit; a slug nobody has
 * published is a 404.
 */
export const revalidate = 300;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return {};
  const title = post.meta_title ?? post.title;
  const description = postDescription(post) ?? undefined;
  return {
    // The layout appends " · Sollos 3" (11 characters). Past ~60 Google cuts
    // the title off, so a long headline goes out without the suffix rather
    // than losing its own last words.
    title: title.length > 49 ? { absolute: title } : title,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      siteName: "Sollos 3",
      title,
      description,
      url: `/blog/${post.slug}`,
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      ...(post.featured_image_url ? { images: [{ url: post.featured_image_url, alt: post.featured_image_alt ?? "" }] } : {}),
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();

  // Cleaned when Holo delivered it; cleaned again here, so a row changed by
  // any other route still can't put a script on the page.
  const html = sanitizeArticleHtml(post.content_html);

  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: postDescription(post) ?? undefined,
            datePublished: post.published_at,
            dateModified: post.updated_at,
            url: `${SITE_URL}/blog/${post.slug}`,
            mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
            ...(post.featured_image_url ? { image: post.featured_image_url } : {}),
            author: { "@id": `${SITE_URL}/#organization` },
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
          breadcrumbJsonLd([
            ["Blog", "/blog"],
            [post.title, `/blog/${post.slug}`],
          ]),
        ]}
      />
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <MarketingHeader />

      <article className="relative z-10 mx-auto w-full max-w-2xl px-6 pt-10 pb-12">
        <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          All articles
        </Link>
        <p className="mt-6 text-xs text-muted-foreground">
          <time dateTime={post.published_at}>{day(post.published_at)}</time>
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{post.title}</h1>
        {post.excerpt && <p className="mt-3 text-base leading-7 text-muted-foreground">{post.excerpt}</p>}

        {post.featured_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.featured_image_url}
            alt={post.featured_image_alt || post.title}
            className="mt-8 aspect-[16/9] w-full rounded-xl border border-border object-cover"
          />
        )}

        <div
          className="blog-article mt-8 rounded-xl border border-border bg-white/80 p-6 shadow-sm backdrop-blur-sm sm:p-8"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Every post links into the product pages. Articles arrive from Holo
            without links back to the site, so without this a post that ranks
            passes nothing on to the pages meant to win the search. */}
        <nav aria-label="Sollos for your kind of cleaning" className="mt-10 rounded-xl border border-border bg-white/80 p-6">
          <p className="text-sm font-semibold">Sollos for your kind of cleaning</p>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {LANDING_PAGES.map((l) => (
              <li key={l.slug}>
                <Link href={`/${l.slug}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                  {l.navLabel}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </article>

      <HelpCta />
      <MarketingFooter />
    </main>
  );
}
