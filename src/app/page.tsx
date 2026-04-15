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
  Shield,
  Smartphone,
  Zap,
  CheckCircle2,
  Star,
  MapPin,
  FileText,
  UserPlus,
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
            href="#features"
            className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
          >
            Features
          </Link>
          <Link
            href="#how-it-works"
            className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
          >
            How it works
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
            Start free
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="sollos-hero relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-20 pb-16 text-center">
        <div className="sollos-kicker mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <Zap className="h-3 w-3 text-amber-500" />
          Built for cleaning companies. Nothing else.
        </div>

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

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Free to start</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> No credit card</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Set up in 5 minutes</span>
        </div>
      </section>

      {/* Trust bar */}
      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <div className="flex flex-wrap items-center justify-center gap-8 rounded-xl border border-border bg-white/80 px-8 py-5 shadow-sm backdrop-blur-sm">
          <Stat value="500+" label="Bookings managed" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <Stat value="99.9%" label="Uptime" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <Stat value="< 2 min" label="Average invoice sent" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <Stat value="24/7" label="Your data, always accessible" />
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Everything you need to run your cleaning business
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
            No more duct-taping 6 different apps together. Sollos 3 handles it all.
          </p>
        </div>

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

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Up and running in minutes
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
            No demos, no sales calls, no 90-day onboarding. Just sign up and go.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="relative text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background text-sm font-bold">
                  {i + 1}
                </div>
                <div className="mx-auto mt-4 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Feature deep-dive: Freelancer Bench */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="grid gap-8 lg:grid-cols-2 items-center">
          <div>
            <div className="sollos-kicker mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <UserPlus className="h-3 w-3 text-indigo-500" />
              Freelancer bench
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Need coverage? Blast your bench.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Keep a roster of on-call freelancers. When a shift needs filling,
              broadcast it to your bench via SMS. The first to claim gets the
              job — or set multiple positions and fill a whole crew at once.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "One-tap SMS claim links — no app download needed",
                "Multi-position shifts — fill 1 or 10 spots per offer",
                "Real-time tracking — see who claimed what, when",
                "Atomic race handling — no double-bookings, ever",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Maria S.</p>
                    <p className="text-xs text-muted-foreground">Claimed 2 min ago</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Claimed</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">James T.</p>
                    <p className="text-xs text-muted-foreground">Claimed 5 min ago</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Claimed</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-dashed border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">1 spot remaining</p>
                    <p className="text-xs text-muted-foreground">3 of 3 positions · expires in 22 min</p>
                  </div>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Open</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature deep-dive: Google Calendar */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="grid gap-8 lg:grid-cols-2 items-center">
          <div className="order-2 lg:order-1 rounded-xl border border-border bg-white p-6 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg bg-indigo-50 px-4 py-2.5 border border-indigo-100">
                <CalendarCheck className="h-4 w-4 text-indigo-600" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-indigo-900">Deep clean — Johnson residence</p>
                  <p className="text-[11px] text-indigo-600">9:00 AM – 12:00 PM</p>
                </div>
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Sollos</span>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-purple-50 px-4 py-2.5 border border-purple-100 border-dashed opacity-80">
                <CalendarCheck className="h-4 w-4 text-purple-600" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-purple-900">Supply run — Costco</p>
                  <p className="text-[11px] text-purple-600">1:00 PM – 2:00 PM</p>
                </div>
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">Google</span>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-indigo-50 px-4 py-2.5 border border-indigo-100">
                <CalendarCheck className="h-4 w-4 text-indigo-600" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-indigo-900">Recurring — Maple St office</p>
                  <p className="text-[11px] text-indigo-600">3:00 PM – 5:30 PM</p>
                </div>
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Sollos</span>
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <div className="sollos-kicker mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <CalendarCheck className="h-3 w-3 text-purple-500" />
              Google Calendar sync
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your whole schedule, one view.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Connect Google Calendar and see personal events alongside your
              cleaning bookings. Sollos pushes confirmed jobs to Google so your
              team always knows what&apos;s next — and pulls your existing
              events in so you never double-book.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "Two-way sync — bookings appear in Google, Google events appear in Sollos",
                "Toggleable overlay — show or hide personal events with one click",
                "No conflicts — see everything before you schedule",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Security / trust */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="rounded-xl border border-border bg-white/80 p-8 shadow-sm backdrop-blur-sm">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your data is safe with us
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
              We built Sollos 3 with security-first architecture. Your customer
              data is your business — we never sell it, share it, or use it
              for anything other than running the product.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-foreground" />
                  </div>
                  <h3 className="mt-2.5 text-xs font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Ready to stop juggling spreadsheets?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Join cleaning companies that run their entire operation from one
          dashboard. Free to start, no credit card required.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border bg-white/50 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {/* Brand */}
            <div className="sm:col-span-2 lg:col-span-1">
              <Link href="/" className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/sollos-logo.png"
                  alt="Sollos 3"
                  className="h-7 w-7 shrink-0 rounded-lg"
                />
                <span className="text-sm font-semibold tracking-tight">
                  Sollos 3
                </span>
              </Link>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground max-w-xs">
                Operations software for cleaning companies. Bookings,
                scheduling, employees, invoicing, chat and field tools —
                all in one place.
              </p>
            </div>

            {/* Product */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Product
              </p>
              <ul className="mt-3 space-y-2">
                <FooterLink href="#features">Features</FooterLink>
                <FooterLink href="#how-it-works">How it works</FooterLink>
                <FooterLink href="/signup">Sign up</FooterLink>
                <FooterLink href="/login">Sign in</FooterLink>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legal
              </p>
              <ul className="mt-3 space-y-2">
                <FooterLink href="/privacy">Privacy policy</FooterLink>
                <FooterLink href="/terms">Terms of service</FooterLink>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </p>
              <ul className="mt-3 space-y-2">
                <FooterLink href="mailto:hello@sollos3.com">hello@sollos3.com</FooterLink>
                <FooterLink href="mailto:support@sollos3.com">support@sollos3.com</FooterLink>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Sollos 3. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">
              Made with care for the people who keep things clean.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ---------- Data ---------- */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center px-2">
      <p className="text-lg font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}

const FEATURES = [
  {
    icon: CalendarCheck,
    title: "Bookings & scheduling",
    body: "Create jobs, assign them to your crew, and see everything on one calendar. Set duration in hours or minutes, create recurring schedules, and filter by status.",
  },
  {
    icon: Users,
    title: "Team management",
    body: "Add employees, set roles, track hours. Need emergency coverage? Blast your freelancer bench in one tap and fill multiple positions at once.",
  },
  {
    icon: CreditCard,
    title: "Invoicing & payments",
    body: "Send invoices, accept online payments, and track who owes what — no more chasing cheques.",
  },
  {
    icon: Clock,
    title: "Field clock-in",
    body: "Your cleaners clock in and out from their phone with GPS verification. You see who's on-site in real time.",
  },
  {
    icon: MessageSquare,
    title: "Team chat",
    body: "Built-in real-time messaging so your crew can coordinate without giving out personal numbers.",
  },
  {
    icon: Smartphone,
    title: "Mobile-first field app",
    body: "Your team gets a clean mobile interface for schedules, clock-in, and chat. No app store download — it's a PWA.",
  },
  {
    icon: MapPin,
    title: "Client management",
    body: "Full client profiles with contact info, addresses, service history, and notes. Never lose track of a customer again.",
  },
  {
    icon: FileText,
    title: "Estimates & contracts",
    body: "Create professional estimates, convert them to bookings with one click, and keep everything linked.",
  },
  {
    icon: BarChart3,
    title: "Reports & timesheets",
    body: "Payroll-ready timesheets, revenue tracking, and employee performance — all calculated automatically.",
  },
];

const STEPS = [
  {
    icon: UserPlus,
    title: "Create your workspace",
    body: "Sign up with your email, name your company, and you're in. Takes about 60 seconds.",
  },
  {
    icon: Users,
    title: "Add your team & clients",
    body: "Invite your employees, add your client list, and set up your services. Import or enter manually.",
  },
  {
    icon: CalendarCheck,
    title: "Start scheduling",
    body: "Create your first booking, assign it to your crew, and send the invoice. You're operational.",
  },
];

const TRUST_ITEMS = [
  {
    icon: Shield,
    title: "Row-level security",
    body: "Every query is scoped to your organization. Your data is physically isolated from other tenants.",
  },
  {
    icon: Star,
    title: "No data selling",
    body: "We don't sell your data, share it with advertisers, or use it to train AI models. Period.",
  },
  {
    icon: Clock,
    title: "Daily backups",
    body: "Your data is backed up daily with a 7-day rotation. Point-in-time recovery available.",
  },
  {
    icon: Zap,
    title: "99.9% uptime",
    body: "Hosted on Vercel's edge network with Supabase for the database. Fast and reliable.",
  },
];
