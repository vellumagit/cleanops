import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import {
  HelpCta,
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing-chrome";
import { HELP_ARTICLES, HELP_SECTIONS } from "@/content/help";
import { breadcrumbJsonLd } from "@/lib/seo";

/**
 * The public face of the Help library — the same articles owners read at
 * /app/help, served without a login so a cleaning company can see how
 * Sollos actually works before signing up, and so search engines can too.
 * One source (src/content/help) feeds both; nothing here is a copy.
 */

export const metadata = {
  title: "Help guides",
  description:
    "How Sollos 3 runs a cleaning company day to day: bookings and recurring schedules, checklists, leads, invoicing, timesheets and payroll, reports, website forms and the client portal.",
  alternates: { canonical: "/help" },
};

export default function PublicHelpPage() {
  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <JsonLd data={breadcrumbJsonLd([["Help", "/help"]])} />
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <MarketingHeader />

      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pt-16 pb-10 text-center">
        <div className="sollos-kicker inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <BookOpen className="h-3 w-3 text-sky-500" />
          Help guides
        </div>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
          How Sollos works
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Short guides to running a cleaning company in Sollos — from the
          first booking to the payroll run. They ship with the app, so
          they describe the version you&apos;d actually be using.
        </p>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-3xl space-y-8 px-6 pb-16">
        {HELP_SECTIONS.map((section) => {
          const articles = HELP_ARTICLES.filter((a) => a.section === section);
          if (articles.length === 0) return null;
          return (
            <div key={section}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section}
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-white/80 shadow-sm backdrop-blur-sm">
                {articles.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`/help/${a.slug}`}
                      className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
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
      </section>

      <HelpCta />
      <MarketingFooter />
    </main>
  );
}
