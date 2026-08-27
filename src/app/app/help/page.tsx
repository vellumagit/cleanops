import Link from "next/link";
import { ChevronRight, Lightbulb } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { HELP_ARTICLES, HELP_SECTIONS } from "@/content/help";

export const metadata = { title: "Help" };

export default async function HelpPage() {
  await requireMembership(["owner", "admin", "manager"]);

  return (
    <PageShell
      title="Help"
      description="How Sollos works — short guides that ship with the app, so they're never out of date."
    >
      <div className="max-w-3xl space-y-8">
        {HELP_SECTIONS.map((section) => {
          const articles = HELP_ARTICLES.filter((a) => a.section === section);
          if (articles.length === 0) return null;
          return (
            <div key={section}>
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
                        <p className="mt-0.5 text-xs text-muted-foreground">
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
            .
          </p>
        </div>
      </div>
    </PageShell>
  );
}
