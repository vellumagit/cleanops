import { redirect } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentMembership } from "@/lib/auth";
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
  Check,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default async function Home() {
  // Authenticated employees belong in /field — they should never see the
  // marketing page. Owners/admins/managers who visit / intentionally (e.g.
  // sharing the link) still see it; they navigate to /app from their session.
  const membership = await getCurrentMembership();
  if (membership?.role === "employee") {
    redirect("/field/jobs");
  }

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
            href="#pricing"
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
            Start 14-day free trial
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
          <Link
            href="#pricing"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              "rounded-full border-border bg-white px-6 text-sm font-semibold shadow-sm hover:bg-muted",
            )}
          >
            See pricing
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> 14 days free</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> No credit card required</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Cancel anytime</span>
        </div>
      </section>

      {/* Trust bar */}
      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <div className="flex flex-wrap items-center justify-center gap-8 rounded-xl border border-border bg-white/80 px-8 py-5 shadow-sm backdrop-blur-sm">
          <Stat value="One place" label="For your whole operation" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <Stat value="5 min" label="To set up your business" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <Stat value="Any device" label="Laptop, phone, tablet" />
          <div className="hidden h-8 w-px bg-border sm:block" />
          <Stat value="Always on" label="Access your jobs 24/7" />
        </div>
      </section>

      {/* Pain points — calls out the actual reality of running a cleaning
          company without dedicated software. Lands the cleaning-specific
          positioning hard before we even start talking features. */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            We get it. You&apos;re running this on six apps and a group chat.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Most cleaning companies grow into a Frankenstein stack: a booking
            app meant for hair salons, an invoicing tool that doesn&apos;t
            know what a recurring clean is, a separate spreadsheet for hours.
            We built Sollos because that was us, too.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PAIN_POINTS.map((p) => (
            <div
              key={p.before}
              className="rounded-xl border border-border bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-red-50">
                  <span className="text-xs">😩</span>
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700/70">
                    Without Sollos
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {p.before}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2.5 border-t border-border pt-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-50">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                    With Sollos
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {p.after}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Everything you need to run your cleaning business
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
            Stop paying for six different apps that don&apos;t talk to each other. Sollos does it all in one.
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
              Subcontractor bench
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Someone called out? Fill the shift in minutes.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Keep a list of freelance cleaners you trust. When a job needs
              covering, text them all at once with a link they tap to claim it.
              First one to say yes gets the job — or fill a whole crew when you
              need three people on a big property.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "One tap to claim — no app download for your subcontractors",
                "Fill one spot or ten — broadcast as many positions as you need",
                "See who claimed what, live — no guessing who's coming",
                "No double-bookings — the system locks it in the moment someone claims",
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
              Connect your Google Calendar and Sollos shows your personal events
              right next to your cleaning jobs. When you book a new job, it
              automatically shows up on your Google Calendar too — so you never
              double-book a dentist appointment over a deep clean.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "Works both ways — jobs go to Google, Google events show in Sollos",
                "Hide personal events with one click when you want to focus",
                "See your whole day before you take on another job",
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

      {/* Testimonials section removed until we have real, consented customer
          quotes. Re-add a section here once two or three customers are live
          and have agreed to be quoted. */}

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

      {/* Pricing */}
      <section id="pricing" className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-20">
        <div className="text-center mb-12">
          <div className="sollos-kicker inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <CreditCard className="h-3 w-3 text-emerald-500" />
            Simple pricing
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            One price. Every feature. No surprises.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Pick the plan that fits your team size. Every plan includes every feature —
            we don&apos;t hide things behind upgrades. Try it free for 14 days, no card required.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {/* Starter */}
          <div className="relative rounded-2xl border border-border bg-white p-6 shadow-sm flex flex-col">
            <div>
              <h3 className="text-sm font-semibold">Starter</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                For solo owners and small crews.
              </p>
            </div>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight">$49</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to <strong className="text-foreground">5 employees</strong>
            </p>

            <ul className="mt-6 space-y-2.5 text-sm flex-1">
              {[
                "All features, zero restrictions",
                "Unlimited clients and jobs",
                "Unlimited invoices",
                "Team chat and clock-in",
                "Subcontractor bench SMS",
                "Google Calendar sync",
                "Email support",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "mt-6 w-full rounded-full border-border text-sm font-semibold",
              )}
            >
              Start 14-day trial
            </Link>
          </div>

          {/* Growth — highlighted */}
          <div className="relative rounded-2xl border-2 border-foreground bg-white p-6 shadow-lg flex flex-col">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-background">
                Most popular
              </span>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Growth</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                For established cleaning operations.
              </p>
            </div>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight">$99</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to <strong className="text-foreground">25 employees</strong>
            </p>

            <ul className="mt-6 space-y-2.5 text-sm flex-1">
              <li className="flex items-start gap-2 font-medium text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>Everything in Starter, plus:</span>
              </li>
              {[
                "Up to 25 employees",
                "Priority email support",
                "Onboarding call included",
                "Advanced reports and exports",
                "Custom branding on invoices",
                "Bulk import of clients & jobs",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: "lg" }),
                "mt-6 w-full rounded-full text-sm font-semibold sollos-cta-glow",
              )}
            >
              Start 14-day trial
            </Link>
          </div>

          {/* Enterprise */}
          <div className="relative rounded-2xl border border-border bg-white p-6 shadow-sm flex flex-col">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-indigo-500" />
                Enterprise
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                For large operations with custom needs.
              </p>
            </div>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight">Custom</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <strong className="text-foreground">25+ employees</strong>
            </p>

            <ul className="mt-6 space-y-2.5 text-sm flex-1">
              <li className="flex items-start gap-2 font-medium text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>Everything in Growth, plus:</span>
              </li>
              {[
                "Unlimited employees",
                "Dedicated account manager",
                "Custom integrations",
                "SSO (single sign-on)",
                "Priority phone support",
                "Custom training for your team",
                "SLA and uptime guarantees",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <Link
              href="mailto:sales@sollos3.com?subject=Enterprise%20inquiry"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "mt-6 w-full rounded-full border-border text-sm font-semibold",
              )}
            >
              Contact sales
            </Link>
          </div>
        </div>

      </section>

      {/* Frequently asked questions — expanded from teaser bricks to a
          real FAQ. Covers the questions cleaning owners actually ask
          before signing up: data ownership, switching from other tools,
          team size limits, mobile, support, refunds. */}
      <section id="faq" className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Questions, answered straight
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            If something here doesn&apos;t cover it, email{" "}
            <a
              href="mailto:hello@sollos3.com"
              className="text-foreground underline-offset-2 hover:underline"
            >
              hello@sollos3.com
            </a>{" "}
            and a real human responds within a few hours.
          </p>
        </div>

        <div className="divide-y divide-border rounded-xl border border-border bg-white/80 shadow-sm backdrop-blur-sm">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group px-5 py-4 sm:px-6"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-foreground list-none [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-180">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Ready to stop juggling spreadsheets?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Try every feature free for 14 days. No credit card, no contracts,
          no sales calls. Just sign up and go.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ size: "lg" }),
              "rounded-full px-6 text-sm font-semibold sollos-cta-glow",
            )}
          >
            Start 14-day free trial
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
                <FooterLink href="/pricing">Pricing</FooterLink>
                <FooterLink href="#how-it-works">How it works</FooterLink>
                <FooterLink href="/signup">Start free trial</FooterLink>
                <FooterLink href="/login">Sign in</FooterLink>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legal
              </p>
              <ul className="mt-3 space-y-2">
                <FooterLink href="/security">Security</FooterLink>
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
    title: "Jobs & scheduling",
    body: "Book jobs, assign them to your cleaners, and see your whole week on one calendar. Set it up once for recurring customers and Sollos fills in the rest.",
  },
  {
    icon: Users,
    title: "Your team, organized",
    body: "Add your cleaners, set what they can see, and track their hours automatically. Need last-minute coverage? Text your subcontractor backup list in one tap.",
  },
  {
    icon: CreditCard,
    title: "Invoices & payments",
    body: "Send professional invoices in seconds and let clients pay online with a card. No more chasing cheques or waiting weeks to get paid.",
  },
  {
    icon: Clock,
    title: "Know who's on the job",
    body: "Your cleaners clock in and out from their phone when they arrive and leave. You see who's where, in real time, without having to call anyone.",
  },
  {
    icon: MessageSquare,
    title: "Built-in team chat",
    body: "Your cleaners can message you and each other without sharing personal phone numbers. Everything's in one place, searchable, and private.",
  },
  {
    icon: Smartphone,
    title: "Works on any device",
    body: "Use it on your laptop at the office or your phone on the road. Your cleaners don't need to download anything — it just works in their browser.",
  },
  {
    icon: MapPin,
    title: "Client records",
    body: "Every client's address, contact info, job history, and notes in one place. Remember that one thing Mrs. Johnson always asks for? Sollos does.",
  },
  {
    icon: FileText,
    title: "Estimates & quotes",
    body: "Send clean-looking estimates to new leads, turn the ones they accept into jobs with a click, and keep the paper trail without the paper.",
  },
  {
    icon: BarChart3,
    title: "Payroll & reports",
    body: "See how much your team worked, how much you made, and how much you owe — all added up for you. No more late-night spreadsheet math.",
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

/**
 * Pain points specific to cleaning operations. Phrased as "the way it
 * usually is" → "the way it should be" so prospects see themselves in
 * the Before and feel the relief in the After.
 */
const PAIN_POINTS = [
  {
    before: "Cleaner texts you at 7am they can't make a 9am job",
    after: "Broadcast the open shift to your subcontractor bench. Filled in minutes.",
  },
  {
    before: "Three different sticky notes for one client's specifics",
    after: "Every client's preferences, codes, and pets in one searchable record.",
  },
  {
    before: "Chasing invoices by phone three weeks after the job",
    after: "Invoice goes out automatically on completion. Pay-by-link in the email.",
  },
  {
    before: "Owner does payroll math at midnight on a spreadsheet",
    after: "Hours and pay rates tracked per cleaner. Payroll runs in minutes.",
  },
  {
    before: "Personal phone numbers shared in a group text with employees",
    after: "Built-in team chat. Numbers stay private. Search history anytime.",
  },
  {
    before: "No idea if a job actually happened until the complaint",
    after: "Cleaners clock in on site with GPS. You see who's where, live.",
  },
];

/**
 * Real FAQs — questions cleaning owners actually ask in pre-sales chats.
 * Order matters: data ownership / switching first (the trust questions),
 * pricing/billing next, then practical/team questions.
 */
const FAQS = [
  {
    q: "Do I own my data?",
    a: "Always. Download a full backup of your account anytime — clients, bookings, invoices, time entries, the works — as a JSON file from Settings → Your data. If you cancel, your data is yours to take with you.",
  },
  {
    q: "I'm switching from Jobber / Housecall Pro / a spreadsheet. Can I import?",
    a: "Yes — we have a bulk client importer that takes a CSV from any tool. If your client list is messy, send it to support and we'll help clean it up during your trial.",
  },
  {
    q: "Do I need a credit card to start the trial?",
    a: "No. The 14-day trial is just an email and a password. We don't ask for billing details until you decide to keep going.",
  },
  {
    q: "What happens after the trial if I don't subscribe?",
    a: "Your account pauses — you can still log in and view everything for 30 days. After that, the account is archived. Subscribe anytime in those 30 days and pick up exactly where you left off.",
  },
  {
    q: "What if my team is bigger than 25 employees?",
    a: "Enterprise plan covers unlimited team size, dedicated onboarding, and custom integrations. Email sales@sollos3.com and we'll get back within a day.",
  },
  {
    q: "Does it work on my cleaners' phones?",
    a: "Yes — Sollos is mobile-first for field staff. No app download required, runs in their browser, works on any phone less than five years old. Owners and managers can use it on desktop, tablet, or phone.",
  },
  {
    q: "Can I send invoices my customers can pay online?",
    a: "Yes. Connect Stripe in two clicks and every invoice you send includes a pay-by-link. Most owners get paid 7-10 days faster than they did with cheques and bank transfers.",
  },
  {
    q: "What kind of support do you offer?",
    a: "Email support on every plan, usually with a same-day response. Growth and Enterprise plans get priority support and an onboarding call. We're a small team that actually answers our own emails.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes, upgrade or downgrade anytime from the billing page. Prorated automatically — you only pay the difference.",
  },
  {
    q: "Is my customer data secure?",
    a: "Yes. Every organization's data is isolated at the database level (we use Postgres row-level security). Encrypted in transit and at rest. We never sell, share, or train AI on your data.",
  },
];

const TRUST_ITEMS = [
  {
    icon: Shield,
    title: "Your data stays yours",
    body: "Your business info is kept separate from every other company on Sollos. Only you and your team can see it.",
  },
  {
    icon: Star,
    title: "Never sold, never shared",
    body: "We don't sell your data, share it with advertisers, or use it to train AI. That's a promise.",
  },
  {
    icon: Clock,
    title: "Backed up every day",
    body: "Your data is backed up automatically every day, so you never have to worry about losing a single invoice or client record.",
  },
  {
    icon: Zap,
    title: "Fast and reliable",
    body: "Built on the same infrastructure that powers major companies. Loads fast, stays up.",
  },
];
