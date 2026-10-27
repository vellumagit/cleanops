import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import {
  HelpCta,
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing-chrome";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { HELP_ARTICLES, getHelpArticle } from "@/content/help";
import { breadcrumbJsonLd, SITE_URL } from "@/lib/seo";

// The article set is fixed at build time — an unknown slug is a 404, not a
// render attempt.
export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) return {};
  return {
    title: `${article.title} — Help`,
    description: article.blurb,
    alternates: { canonical: `/help/${article.slug}` },
    openGraph: {
      // Replaces the layout's openGraph object wholesale, so siteName is
      // restated rather than inherited.
      type: "article",
      siteName: "Sollos 3",
      title: `${article.title} — Sollos 3 help`,
      description: article.blurb,
      url: `/help/${article.slug}`,
    },
  };
}

export default async function PublicHelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();

  const idx = HELP_ARTICLES.findIndex((a) => a.slug === slug);
  const prev = idx > 0 ? HELP_ARTICLES[idx - 1] : null;
  const next = idx < HELP_ARTICLES.length - 1 ? HELP_ARTICLES[idx + 1] : null;

  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: article.title,
            description: article.blurb,
            articleSection: article.section,
            url: `${SITE_URL}/help/${article.slug}`,
            about: { "@id": `${SITE_URL}/#software` },
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
          breadcrumbJsonLd([
            ["Help", "/help"],
            [article.title, `/help/${article.slug}`],
          ]),
        ]}
      />
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <MarketingHeader />

      <article className="relative z-10 mx-auto w-full max-w-2xl px-6 pt-10 pb-12">
        <Link
          href="/help"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          All guides
        </Link>
        <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {article.section}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {article.title}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          {article.blurb}
        </p>

        <div className="mt-8 rounded-xl border border-border bg-white/80 p-6 shadow-sm backdrop-blur-sm">
          <SimpleMarkdown source={article.body} />
        </div>

        <nav className="mt-4 flex items-center justify-between gap-3 text-sm">
          {prev ? (
            <Link
              href={`/help/${prev.slug}`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/help/${next.slug}`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {next.title}
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </article>

      <HelpCta />
      <MarketingFooter />
    </main>
  );
}
