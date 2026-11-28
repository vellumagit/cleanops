import Link from "next/link";
import { ArrowRight, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { JsonLd } from "@/components/json-ld";
import { CtaButtons } from "@/components/landing-page";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { COMPARE_PAGES, type ComparePageContent } from "@/content/compare";
import { LANDING_PAGES } from "@/content/landing";
import { breadcrumbJsonLd, faqPageJsonLd, softwareApplicationJsonLd } from "@/lib/seo";

/**
 * The template behind every "<competitor> alternative" page
 * (src/content/compare.ts). Same chrome and cards as the landing pages, plus
 * the two tables a comparison needs. Metadata comes from landingMetadata().
 */

const CARD = "rounded-xl border border-border bg-white/80 shadow-sm backdrop-blur-sm";

export function ComparePage({ page }: { page: ComparePageContent }) {
  const others = COMPARE_PAGES.filter((p) => p.slug !== page.slug);
  const sollosLabel = page.price.columns[1];

  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          faqPageJsonLd(page.faqs),
          breadcrumbJsonLd([[page.navLabel, `/${page.slug}`]]),
        ]}
      />
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <MarketingHeader />

      {/* Hero */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pt-16 pb-14 text-center">
        <div className="sollos-kicker inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          {page.kicker}
        </div>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">{page.h1}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {page.intro}
        </p>
        <CtaButtons className="mt-8" />
        <p className="mt-3 text-xs text-muted-foreground">
          14-day free trial · No credit card · Month to month
        </p>
      </section>

      {/* Price */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <div className={cn(CARD, "p-6 sm:p-8")}>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{page.price.heading}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{page.price.intro}</p>
          <ComparisonTable
            className="mt-6"
            columns={page.price.columns}
            rows={page.price.rows.map((r) => ({ label: r.team, cells: r.cells }))}
          />
          <ul className="mt-5 space-y-2 text-xs leading-5 text-muted-foreground">
            {page.price.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>
              {page.competitor} prices from{" "}
              <a
                href={page.source.href}
                rel="nofollow noopener"
                target="_blank"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {page.source.label}
              </a>
              , checked {page.checkedOn}. Check there for current rates.
            </li>
          </ul>
        </div>
      </section>

      {/* Why switch */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <h2 className="mb-6 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Why cleaning companies switch from {page.competitor}
        </h2>
        <div className="grid gap-5 md:grid-cols-3">
          {page.whySwitch.map((w) => (
            <div key={w.heading} className={cn(CARD, "p-6")}>
              <h3 className="text-base font-bold tracking-tight">{w.heading}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Every plan */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <div className={cn(CARD, "p-6 sm:p-8")}>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            What you get on every Sollos plan
          </h2>
          <ul className="mt-5 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {page.everyPlan.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm leading-6">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/pricing"
            className="mt-5 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            Compare Sollos plans <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* Where the competitor wins */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-16">
        <div className={cn(CARD, "p-6 sm:p-8")}>
          <Info className="h-5 w-5 text-sky-500" />
          <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
            Where {page.competitor} is the better choice
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{page.betterIf.intro}</p>
          <ul className="mt-4 list-disc space-y-2.5 pl-5 text-sm leading-6 marker:text-muted-foreground">
            {page.betterIf.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-6 font-medium">{page.betterIf.outro}</p>
        </div>
      </section>

      {/* Feature comparison */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <div className={cn(CARD, "p-6 sm:p-8")}>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Feature comparison</h2>
          <ComparisonTable
            className="mt-6"
            columns={["Feature", sollosLabel, page.competitor]}
            rows={page.features.map((f) => ({
              label: f.feature,
              cells: [f.sollos, f.them],
              mutedSollos: f.gap,
            }))}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            {page.competitor} features as listed on its pricing page, checked {page.checkedOn}.
          </p>
        </div>
      </section>

      {/* Switching */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-16">
        <div className={cn(CARD, "p-6 sm:p-8")}>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            Switching from {page.competitor}
          </h2>
          <ol className="mt-5 space-y-3">
            {page.switching.steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3 text-sm leading-6">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">{page.switching.after}</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-16">
        <h2 className="mb-6 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Common questions
        </h2>
        <div className={cn(CARD, "divide-y divide-border")}>
          {page.faqs.map((f) => (
            <details key={f.q} className="group px-5 py-4 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-10 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Try it with your own jobs</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Set up your recurring clients and cleaners in an afternoon and see your week on one
          board. 14 days free, no card and no contract.
        </p>
        <CtaButtons className="mt-6" />
        <p className="mx-auto mt-8 max-w-xl text-[11px] leading-5 text-muted-foreground">
          {page.disclaimer}
        </p>
      </section>

      {/* Cross-links */}
      <nav aria-label="More from Sollos 3" className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Also on Sollos 3
        </p>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {[...LANDING_PAGES, ...others].map((o) => (
            <li key={o.slug}>
              <Link
                href={`/${o.slug}`}
                className="inline-flex rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              >
                {o.navLabel}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/help/bookings"
              className="inline-flex rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
            >
              How bookings work
            </Link>
          </li>
        </ul>
      </nav>

      <MarketingFooter />
    </main>
  );
}

/**
 * A row-label table whose second column is Sollos. A real table from `sm` up;
 * below that, each row stacks into a card with the column names as labels, so
 * a phone never scrolls sideways through three columns of prose.
 */
function ComparisonTable({
  columns,
  rows,
  className,
}: {
  columns: readonly string[];
  rows: ReadonlyArray<{ label: string; cells: readonly string[]; mutedSollos?: boolean }>;
  className?: string;
}) {
  const [labelHeading, ...cellHeadings] = columns;
  const sollosCell = (muted?: boolean) =>
    muted ? "text-muted-foreground" : "font-semibold text-foreground";

  return (
    <div className={className}>
      <table className="hidden w-full table-fixed text-sm sm:table">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-3 pr-4 font-semibold">
              {labelHeading}
            </th>
            {cellHeadings.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn("px-3 py-3 font-semibold", i === 0 && "rounded-t-lg bg-emerald-50")}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-3 pr-4 text-left font-medium text-muted-foreground">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-3 py-3 align-top leading-6",
                    i === 0 ? cn("bg-emerald-50/70", sollosCell(r.mutedSollos)) : "text-muted-foreground",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="space-y-3 sm:hidden">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg border border-border bg-white p-4">
            <dt className="text-sm font-semibold">{r.label}</dt>
            {r.cells.map((c, i) => (
              <dd key={i} className="mt-1.5 flex gap-2 text-sm leading-5">
                <span className="w-24 shrink-0 text-xs leading-5 text-muted-foreground">
                  {cellHeadings[i]}
                </span>
                <span className={i === 0 ? sollosCell(r.mutedSollos) : "text-muted-foreground"}>{c}</span>
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );
}
