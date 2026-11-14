import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LANDING_PAGES } from "@/content/landing";

/**
 * Header and footer for public pages that aren't the homepage — the same
 * nav and footer the pricing page draws inline, so a visitor arriving on a
 * help article from search sees the site they'd see from the front door.
 */

export function MarketingHeader() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sollos-logo.png"
          alt="Sollos 3"
          className="h-8 w-8 shrink-0 rounded-lg"
        />
        <span className="text-base font-semibold tracking-tight">Sollos 3</span>
      </Link>
      <nav className="flex items-center gap-1">
        <Link
          href="/pricing"
          className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
        >
          Pricing
        </Link>
        <Link
          href="/blog"
          className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
        >
          Blog
        </Link>
        <Link
          href="/login"
          className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className={cn(
            buttonVariants({ size: "sm" }),
            "rounded-full px-4 shadow-sm sollos-cta-glow",
          )}
        >
          Start free trial
        </Link>
      </nav>
    </header>
  );
}

/**
 * The one footer for every public page: home, pricing, the landing pages,
 * help and the blog. Until 2026-11-14 the homepage had this full footer and
 * every other page a one-line version with different links, so the blog
 * looked like a different site and the homepage had no way to reach it.
 */
export function MarketingFooter() {
  return (
    <footer className="relative z-10 border-t border-border bg-white/50 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/sollos-logo.png" alt="Sollos 3" className="h-7 w-7 shrink-0 rounded-lg" />
              <span className="text-sm font-semibold tracking-tight">Sollos 3</span>
            </Link>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Operations software for cleaning companies. Bookings, scheduling, employees, invoicing, chat and field
              tools — all in one place.
            </p>
          </div>

          <FooterColumn title="Product">
            <FooterLink href="/#features">Features</FooterLink>
            <FooterLink href="/pricing">Pricing</FooterLink>
            <FooterLink href="/#how-it-works">How it works</FooterLink>
            <FooterLink href="/help">Help guides</FooterLink>
            <FooterLink href="/blog">Blog</FooterLink>
            <FooterLink href="/signup">Start free trial</FooterLink>
            <FooterLink href="/login">Sign in</FooterLink>
          </FooterColumn>

          {/* One landing page per kind of cleaning business */}
          <FooterColumn title="Solutions">
            {LANDING_PAGES.map((l) => (
              <FooterLink key={l.slug} href={`/${l.slug}`}>
                {l.navLabel}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="Legal">
            <FooterLink href="/security">Security</FooterLink>
            <FooterLink href="/privacy">Privacy policy</FooterLink>
            <FooterLink href="/terms">Terms of service</FooterLink>
          </FooterColumn>

          <FooterColumn title="Contact">
            <FooterLink href="mailto:hello@sollos3.com">hello@sollos3.com</FooterLink>
            <FooterLink href="mailto:support@sollos3.com">support@sollos3.com</FooterLink>
          </FooterColumn>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Sollos 3. All rights reserved.</p>
          <p className="text-xs text-muted-foreground">Made with care for the people who keep things clean.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
        {children}
      </Link>
    </li>
  );
}

/** Closing call to action on the public help pages. */
export function HelpCta() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20 text-center">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        See it with your own jobs
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        14 days free, no card required. Built for cleaning companies in
        Canada and the US.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
    </section>
  );
}
