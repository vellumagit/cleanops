import Link from "next/link";
import { Newspaper } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { HelpCta, MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { listPublishedPosts } from "@/lib/blog";
import { breadcrumbJsonLd, SITE_URL } from "@/lib/seo";

/**
 * The Sollos blog index (2026-11-13). Articles are written in Holo and
 * arrive by webhook (app/api/integrations/holo/webhook), which refreshes
 * this page the moment one is published; it also refreshes itself every
 * five minutes.
 */
export const revalidate = 300;

export const metadata = {
  title: "Blog",
  description:
    "Practical articles for cleaning business owners: running crews, scheduling, pricing, invoicing and growing a residential or commercial cleaning company.",
  alternates: { canonical: "/blog" },
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function BlogIndexPage() {
  const posts = await listPublishedPosts();

  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "Sollos 3 blog",
            url: `${SITE_URL}/blog`,
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
          breadcrumbJsonLd([["Blog", "/blog"]]),
        ]}
      />
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <MarketingHeader />

      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pt-16 pb-10 text-center">
        <div className="sollos-kicker inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <Newspaper className="h-3 w-3 text-sky-500" />
          Blog
        </div>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">Running a cleaning company</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Practical notes for owners: crews, schedules, pricing, invoicing and growth.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-16">
        {posts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-white/70 px-6 py-12 text-center text-sm text-muted-foreground">
            The first articles are on their way.
          </p>
        ) : (
          <ul className="grid gap-4">
            {posts.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/blog/${p.slug}`}
                  className="group flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-white/80 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-foreground/20 sm:flex-row"
                >
                  {p.featured_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.featured_image_url}
                      alt={p.featured_image_alt ?? ""}
                      loading="lazy"
                      className="aspect-[16/9] w-full shrink-0 rounded-lg object-cover sm:w-48"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={p.published_at}>{day(p.published_at)}</time>
                    </p>
                    <h2 className="mt-1 text-lg font-semibold leading-snug group-hover:underline">{p.title}</h2>
                    {p.excerpt && <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-muted-foreground">{p.excerpt}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HelpCta />
      <MarketingFooter />
    </main>
  );
}
