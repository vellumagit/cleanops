import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { HELP_ARTICLES, getHelpArticle } from "@/content/help";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
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
      <div className="max-w-2xl">
        <div className="rounded-lg border border-border bg-card p-6">
          <SimpleMarkdown source={article.body} />
        </div>

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
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {next.title}
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      </div>
    </PageShell>
  );
}
