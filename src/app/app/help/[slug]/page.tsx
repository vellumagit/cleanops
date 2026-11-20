import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SimpleMarkdown, markdownOutline } from "@/lib/simple-markdown";
import { HELP_ARTICLES, getHelpArticle } from "@/content/help";
import { SITE_MAP, staticUrlFor } from "@/content/help/site-map";
import { AskAssistantButton } from "@/components/help/ask-assistant-button";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  return { title: article ? `${article.title} — Help` : "Help" };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();

  const idx = HELP_ARTICLES.findIndex((a) => a.slug === slug);
  const prev = idx > 0 ? HELP_ARTICLES[idx - 1] : null;
  const next = idx < HELP_ARTICLES.length - 1 ? HELP_ARTICLES[idx + 1] : null;
  const outline = markdownOutline(article.body);

  // The pages this guide covers that a person can open directly (no [id]).
  const openPages = article.paths
    .map((p) => ({ url: staticUrlFor(p), page: SITE_MAP.find((s) => s.path === p) }))
    .filter((x): x is { url: string; page: (typeof SITE_MAP)[number] } =>
      Boolean(x.url && x.page && x.page.area === "office"),
    );

  return (
    <PageShell
      title={article.title}
      description={article.section}
      actions={
        <Link
          href="/app/help"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-4 w-4" />
          All guides
        </Link>
      }
    >
      <div className="flex max-w-5xl flex-col gap-6 lg:flex-row-reverse lg:items-start">
        {/* Side rail: on a phone it sits above the article, collapsed to
            what matters (jump links); on a desk it stays in view. */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:w-64 lg:shrink-0">
          {outline.length > 1 && (
            <nav className="rounded-lg border border-border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                On this page
              </p>
              <ul className="space-y-1.5 text-sm">
                {outline.map((h) => (
                  <li key={h.anchor}>
                    <a
                      href={`#${h.anchor}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {openPages.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Go to
              </p>
              <ul className="space-y-1.5 text-sm">
                {openPages.map(({ url, page }) => (
                  <li key={url}>
                    <Link
                      href={url}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      {page.name}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs leading-5 text-muted-foreground">
              Still stuck? The assistant has read every guide.
            </p>
            <AskAssistantButton
              question={`About ${article.title}: `}
              className="mt-2"
            />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="rounded-lg border border-border bg-card p-6">
            <SimpleMarkdown source={article.body} />
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Something here doesn&apos;t match what you see?{" "}
            <Link
              href={`/app/feedback/new?page=${encodeURIComponent(`/app/help/${article.slug}`)}`}
              className="underline underline-offset-2"
            >
              Tell us
            </Link>{" "}
            — the app changed first, and the guide gets fixed.
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            {prev ? (
              <Link
                href={`/app/help/${prev.slug}`}
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
                href={`/app/help/${next.slug}`}
                className="inline-flex items-center gap-1 text-right text-muted-foreground hover:text-foreground"
              >
                {next.title}
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
