import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Globe2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { JsonLd } from "@/components/json-ld";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { getHelpArticle } from "@/content/help";
import { LANDING_PAGES, type LandingPageContent } from "@/content/landing";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/seo";

/**
 * The template behind every landing page (src/content/landing.ts). Each page
 * file is three lines; the words live in the content module and the layout
 * lives here, so four pages can't drift into four designs.
 */

export function landingMetadata(page: LandingPageContent): Metadata {
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical: `/${page.slug}` },
    openGraph: {
      // Replaces the layout's openGraph object wholesale, so siteName is
      // restated rather than inherited.
      type: "website",
      siteName: "Sollos 3",
      title: `${page.metaTitle} · Sollos 3`,
      description: page.metaDescription,
      url: `/${page.slug}`,
    },
  };
}

export function LandingPage({ page }: { page: LandingPageContent }) {
  const others = LANDING_PAGES.filter((p) => p.slug !== page.slug);

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
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
          {page.h1}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {page.intro}
        </p>
        <CtaButtons className="mt-8" />
        <p className="mt-3 text-xs text-muted-foreground">
          14-day free trial · No credit card · Month to month
        </p>
      </section>

      {/* What it does */}
      <section className="relative z-10 mx-auto w-full max-w-5xl space-y-5 px-6 pb-16">
        {page.sections.map((s) => {
          const guide = s.guide ? getHelpArticle(s.guide) : undefined;
          return (
            <div
              key={s.heading}
              className="grid gap-6 rounded-xl border border-border bg-white/80 p-6 shadow-sm backdrop-blur-sm sm:p-8 lg:grid-cols-[2fr_3fr]"
            >
              <div>
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                  {s.heading}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {s.body}
                </p>
                {guide && (
                  <Link
                    href={`/help/${guide.slug}`}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    How it works: {guide.title}
                  </Link>
                )}
              </div>
              <ul className="space-y-3">
                {s.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm leading-6">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Canada & US, and price */}
      <section className="relative z-10 mx-auto grid w-full max-w-5xl gap-5 px-6 pb-16 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-white/80 p-6 shadow-sm backdrop-blur-sm">
          <Globe2 className="h-5 w-5 text-sky-500" />
          <h2 className="mt-3 text-lg font-bold tracking-tight">
            Built for Canada and the US
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Bill your clients in CAD or USD, put your own tax label and rate
            on invoices (GST, HST or sales tax), and see your province&apos;s
            or state&apos;s statutory holidays right on the schedule.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-white/80 p-6 shadow-sm backdrop-blur-sm">
          <p className="text-sm font-semibold">Simple pricing</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight">
            From $49<span className="text-sm font-medium text-muted-foreground">/month USD</span>
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Starter covers up to 5 employees; Growth is $99 for up to 25.
            Month to month, cancel anytime.
          </p>
          <Link
            href="/pricing"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            Compare plans <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-16">
        <h2 className="mb-6 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Common questions
        </h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-white/80 shadow-sm backdrop-blur-sm">
          {page.faqs.map((f) => (
            <details key={f.q} className="group px-5 py-4 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-14 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Try it with your own jobs
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Set up your services, add a few clients, and book next week. 14 days
          free, no card required.
        </p>
        <CtaButtons className="mt-6" />
      </section>

      {/* The other landing pages */}
      <nav
        aria-label="More from Sollos 3"
        className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16"
      >
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Also on Sollos 3
        </p>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {others.map((o) => (
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
              href="/help"
              className="inline-flex rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
            >
              Help guides
            </Link>
          </li>
        </ul>
      </nav>

      <MarketingFooter />
    </main>
  );
}

function CtaButtons({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      <Link
        href="/signup"
        className={cn(
          buttonVariants({ size: "lg" }),
          "rounded-full px-6 text-sm font-semibold sollos-cta-glow",
        )}
      >
        Start free trial
        <ArrowRight className="ml-1.5 h-4 w-4" />
      </Link>
      <Link
        href="/pricing"
        className={cn(
          buttonVariants({ size: "lg", variant: "outline" }),
          "rounded-full border-border bg-white px-6 text-sm font-semibold shadow-sm hover:bg-muted",
        )}
      >
        See pricing
      </Link>
    </div>
  );
}
