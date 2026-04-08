import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <div className="sollos-dots absolute inset-0" aria-hidden />

      {/* Top nav */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sollos-logo.svg"
            alt="Sollos 3"
            className="h-8 w-8 shrink-0 rounded-lg"
          />
          <span className="text-base font-semibold tracking-tight">
            Sollos 3
          </span>
        </Link>
        <nav className="flex items-center gap-1">
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
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="sollos-hero relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <span className="sollos-kicker">
          <Sparkles className="h-3.5 w-3.5" />
          Sollos 3 · Ops software for cleaning companies
        </span>

        <h1 className="mt-6 text-5xl font-extrabold text-foreground sm:text-6xl lg:text-7xl">
          Run every <span className="text-primary">crew</span>,<br />
          every <span className="text-primary">job</span>, every{" "}
          <span className="text-primary">invoice</span>.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          Bookings, scheduling, field clock-in, chat, reviews, bonuses and
          billing — built multi-tenant on Supabase with row-level security on
          every row.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ size: "lg" }),
              "rounded-full px-6 text-sm font-semibold sollos-cta-glow",
            )}
          >
            Start your workspace
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              "rounded-full border-border bg-white px-6 text-sm font-semibold shadow-sm hover:bg-muted",
            )}
          >
            Sign in
          </Link>
        </div>

        <dl className="mt-16 grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
          {[
            {
              title: "Multi-tenant",
              body: "RLS-enforced isolation at the database level.",
            },
            {
              title: "Field-first",
              body: "A mobile shell for cleaners, a console for admins.",
            },
            {
              title: "Audit-logged",
              body: "Every sensitive mutation is append-only recorded.",
            },
          ].map((f) => (
            <div key={f.title} className="sollos-card p-4">
              <dt className="sollos-label">{f.title}</dt>
              <dd className="mt-1.5 text-sm text-foreground">{f.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Sollos 3 · Built on Next.js, Supabase,
            Vercel
          </p>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
