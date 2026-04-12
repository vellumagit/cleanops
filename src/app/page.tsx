import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  ArrowRight,
  CalendarCheck,
  Clock,
  CreditCard,
  MessageSquare,
  Users,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="sollos-wash relative flex flex-1 flex-col">
      <div className="sollos-dots absolute inset-0" aria-hidden />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sollos-logo.png"
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
            Start free
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="sollos-hero relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl font-extrabold text-foreground sm:text-5xl lg:text-6xl">
          The back office your
          <br />
          cleaning company deserves.
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
          Schedule jobs, manage your crew, send invoices, and get paid —
          all from one place. Built for cleaning businesses that are done
          juggling spreadsheets.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ size: "lg" }),
              "rounded-full px-6 text-sm font-semibold sollos-cta-glow",
            )}
          >
            Get started for free
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
      </section>

      {/* Features grid */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="sollos-card p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-4.5 w-4.5 text-foreground" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Social proof / simple stat */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          Stop losing jobs to chaos. Start running your business like you mean it.
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:underline underline-offset-4"
        >
          Create your free account
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Sollos 3
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

const FEATURES = [
  {
    icon: CalendarCheck,
    title: "Bookings & scheduling",
    body: "Create jobs, assign them to your crew, and see everything on one calendar. Drag, drop, done.",
  },
  {
    icon: Users,
    title: "Team management",
    body: "Add employees, set roles, track hours. Need emergency coverage? Blast your freelancer bench in one tap.",
  },
  {
    icon: CreditCard,
    title: "Invoicing & payments",
    body: "Send invoices, accept online payments, and track who owes what — no more chasing cheques.",
  },
  {
    icon: Clock,
    title: "Field clock-in",
    body: "Your cleaners clock in and out from their phone. You see who's on-site in real time.",
  },
  {
    icon: MessageSquare,
    title: "Team chat",
    body: "Built-in messaging so your crew can coordinate without giving out personal numbers.",
  },
  {
    icon: BarChart3,
    title: "Everything in one place",
    body: "Clients, estimates, contracts, reviews, training — stop paying for 6 different tools.",
  },
];
