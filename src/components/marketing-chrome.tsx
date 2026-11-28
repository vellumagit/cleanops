import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LANDING_PAGES } from "@/content/landing";
import { COMPARE_PAGES } from "@/content/compare";
import { MobileMenu } from "@/components/marketing/mobile-menu";

/**
 * Header and footer for public pages that aren't the homepage — the same
 * nav and footer the pricing page draws inline, so a visitor arriving on a
 * help article from search sees the site they'd see from the front door.
 */

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#field-app", label: "Field app" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
];

/**
 * The one header for every public page: home, pricing, the landing pages,
 * help and the blog. Sticky, and with a real menu at phone width (until
 * 2026-11-21 a phone saw only "Sign in" and the trial button, with no way to
 * reach pricing or the blog from the top of any page).
 */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-200/70 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70">
      <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <SollosMark />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Link
            href="/login"
            className="hidden rounded-full px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "sm" }), "rounded-full px-4 shadow-sm")}
          >
            Start free trial
          </Link>
          <MobileMenu>
            <nav aria-label="Main" className="flex flex-col">
              {[...NAV_LINKS, { href: "/login", label: "Sign in" }].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="border-b border-zinc-100 py-3 text-[15px] font-medium text-zinc-800 last:border-0"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}

/** Logo and name, linking home. next/image: the source PNG is 2000 px and 660 KB. */
function SollosMark({ size = 32 }: { size?: number }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2">
      <Image src="/sollos-logo.png" alt="" width={size} height={size} className="shrink-0 rounded-lg" />
      <span className="text-base font-semibold tracking-tight text-zinc-900">Sollos 3</span>
    </Link>
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
    <footer className="relative z-10 border-t border-zinc-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-1">
            <SollosMark size={28} />
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
            <FooterLink href="/client/login">Client sign-in</FooterLink>
          </FooterColumn>

          {/* One landing page per kind of cleaning business */}
          <FooterColumn title="Solutions">
            {[...LANDING_PAGES, ...COMPARE_PAGES].map((l) => (
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
          {/* The site sells to cleaning companies; their clients land here
              too, looking for their cleaner. This is their door. */}
          <p className="text-xs text-muted-foreground">
            Here to see your cleaner?{" "}
            <Link href="/client/login" className="font-medium text-foreground underline underline-offset-4">
              See your cleans
            </Link>
          </p>
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
