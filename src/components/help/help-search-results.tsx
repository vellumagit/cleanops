import Link from "next/link";
import { ChevronRight, HelpCircle } from "lucide-react";
import type { HelpSearchResult } from "@/content/help/search";
import { cn } from "@/lib/utils";

/** The result list under the Help search box. Each result opens the guide
 *  at the matching section. */
export function HelpSearchResults({
  query,
  results,
  helpBase,
  variant = "app",
  empty,
}: {
  query: string;
  results: HelpSearchResult[];
  helpBase: string;
  variant?: "app" | "public";
  /** Shown under "Nothing matched" — the app offers the assistant here. */
  empty?: React.ReactNode;
}) {
  if (results.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border p-6 text-center",
          variant === "public" ? "bg-white/70" : "bg-card",
        )}
      >
        <p className="text-sm font-medium">Nothing in the manual matched “{query}”.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try fewer words, or the name of the page you&apos;re on.
        </p>
        {empty && <div className="mt-4">{empty}</div>}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {results.length === 1 ? "1 match" : `${results.length} matches`} for “{query}”
      </p>
      <ul
        className={cn(
          "divide-y divide-border rounded-lg border border-border",
          variant === "public" ? "bg-white/80 shadow-sm" : "bg-card",
        )}
      >
        {results.map((r, i) => (
          <li key={`${r.slug}-${r.anchor ?? "top"}-${i}`}>
            <Link
              href={`${helpBase}/${r.slug}${r.anchor ? `#${r.anchor}` : ""}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              {r.kind === "question" ? (
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {r.heading ?? r.articleTitle}
                </p>
                <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {r.heading ? `${r.articleTitle} · ${r.section}` : r.section}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {r.snippet}
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
