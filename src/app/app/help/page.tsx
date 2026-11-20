import Link from "next/link";
import { ChevronRight, Lightbulb } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { HELP_ARTICLES, HELP_SECTIONS, searchHelp } from "@/content/help";
import { HelpSearchBox } from "@/components/help/help-search-box";
import { HelpSearchResults } from "@/components/help/help-search-results";
import { AskAssistantButton } from "@/components/help/ask-assistant-button";

export const metadata = { title: "Help" };

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const sp = await searchParams;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").slice(0, 200).trim();
  const results = query ? searchHelp(query) : [];

  return (
    <PageShell
      title="Help"
      description={`The Sollos manual — ${HELP_ARTICLES.length} guides that ship with the app, so they describe the version you're using.`}
    >
      <div className="max-w-3xl space-y-8">
        <div className="space-y-3">
          <HelpSearchBox initialQuery={query} autoFocus={!query} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Can&apos;t find it?</span>
            <AskAssistantButton
              question={query}
              label={query ? `Ask the assistant “${query}”` : "Ask the assistant"}
            />
          </div>
        </div>

        {query ? (
          <HelpSearchResults
            query={query}
            results={results}
            helpBase="/app/help"
            empty={
              <AskAssistantButton
                question={query}
                label="Ask the assistant instead"
              />
            }
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {HELP_SECTIONS.map((section) => {
              const articles = HELP_ARTICLES.filter((a) => a.section === section);
              if (articles.length === 0) return null;
              return (
                <div key={section} className="min-w-0">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section}
                  </h2>
                  <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                    {articles.map((a) => (
                      <li key={a.slug}>
                        <Link
                          href={`/app/help/${a.slug}`}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{a.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {a.blurb}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            Looking for the small tricks — type-ahead, fast paths, hidden
            shortcuts? Those live at{" "}
            <Link href="/app/settings/tips" className="underline underline-offset-2">
              Settings → Tips &amp; shortcuts
            </Link>
            . For your own team&apos;s content — how your org cleans, house
            rules — build modules under{" "}
            <Link href="/app/training" className="underline underline-offset-2">
              Training
            </Link>
            . Something wrong or missing here?{" "}
            <Link href="/app/feedback/new?page=/app/help" className="underline underline-offset-2">
              Tell us
            </Link>
            .
          </p>
        </div>
      </div>
    </PageShell>
  );
}
