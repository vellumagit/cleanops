import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

export function MarketingFooter() {
  return (
    <footer className="relative z-10 border-t border-border bg-white/50 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Sollos 3
          </p>
          <nav className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <span>·</span>
            <Link href="/help" className="hover:text-foreground">Help</Link>
            <span>·</span>
            <Link href="/security" className="hover:text-foreground">Security</Link>
            <span>·</span>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <span>·</span>
            <Link href="mailto:hello@sollos3.com" className="hover:text-foreground">Contact</Link>
          </nav>
        </div>
      </div>
    </footer>
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
