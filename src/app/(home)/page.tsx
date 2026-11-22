import { redirect } from "next/navigation";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Camera,
  Check,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Clock,
  DatabaseBackup,
  Download,
  FileSignature,
  Inbox,
  ListChecks,
  Lock,
  MapPin,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Smartphone,
  Star,
  UserPlus,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentMembership } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { JsonLd } from "@/components/json-ld";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { BrowserFrame, PhoneFrame } from "@/components/marketing/device-frames";
import { LANDING_PAGES } from "@/content/landing";
import { PLANS, faqPageJsonLd, organizationJsonLd, softwareApplicationJsonLd } from "@/lib/seo";

// Real screens of the app, captured from a seeded demo company ("Northbank
// Cleaning Co.", every name invented) on a throwaway database — never from
// production or a customer. Static imports give next/image the size and a
// blur placeholder, and it serves each one resized and re-encoded.
import dashboardShot from "@/assets/landing/dashboard.webp";
import schedulingShot from "@/assets/landing/scheduling.webp";
import bookingsShot from "@/assets/landing/bookings.webp";
import invoiceShot from "@/assets/landing/invoice.webp";
import payrollShot from "@/assets/landing/payroll.webp";
import fieldTodayShot from "@/assets/landing/field-today.webp";
import fieldJobShot from "@/assets/landing/field-job.webp";
import fieldClockShot from "@/assets/landing/field-clock.webp";

// Title and description come from the root layout; only the canonical is
// page-specific. It can't live in the layout — every page would inherit it
// and tell Google it's a duplicate of the homepage.
export const metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  // Authenticated employees belong in /field — they should never see the
  // marketing page. Owners/admins/managers who visit / intentionally (e.g.
  // sharing the link) still see it; they navigate to /app from their session.
  const membership = await getCurrentMembership();
  if (membership?.role === "employee") {
    redirect("/field/jobs");
  }
  // Same for portal clients: sollos3.com is their cleaning company's site,
  // not a SaaS pitch. No membership + a linked client row → their portal.
  if (!membership) {
    const { getCurrentClient } = await import("@/lib/client-auth");
    const client = await getCurrentClient();
    if (client) redirect("/client");
  }

  return (
    // Light only, on purpose: the product screenshots are the light theme,
    // and a dark page around them reads as two different products.
    <main className="relative isolate flex flex-1 flex-col overflow-x-clip bg-white text-zinc-900 [color-scheme:light]">
      <JsonLd data={[organizationJsonLd(), softwareApplicationJsonLd(), faqPageJsonLd(FAQS)]} />

      <MarketingHeader />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px] bg-[radial-gradient(55%_60%_at_50%_0%,rgba(99,102,241,0.13),rgba(255,255,255,0)_70%)]"
        />
        <div
          aria-hidden
          className="sollos-dots pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000,transparent)]"
        />

        <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 pt-14 text-center sm:px-6 sm:pt-20">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 shadow-sm">
            <Zap className="h-3 w-3 text-amber-500" aria-hidden />
            Built for cleaning companies. Nothing else.
          </p>
          <h1 className="mt-6 text-balance text-[2.5rem] font-bold leading-[1.05] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]">
            The back office your cleaning company deserves.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
            Schedule jobs, run your crew, send invoices and get paid — from one place. Your cleaners get a phone app
            for their day; you get the whole business on one screen.
          </p>
          <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-full px-6 text-sm font-semibold shadow-sm")}
            >
              Start 14-day free trial
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="#features"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "h-11 rounded-full border-zinc-200 bg-white px-6 text-sm font-semibold shadow-sm hover:bg-zinc-50",
              )}
            >
              See the product
            </Link>
          </div>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-zinc-500">
            {["14 days free", "No credit card required", "Cancel anytime"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CircleCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Product: the office dashboard, with a cleaner's phone in front */}
        <div className="mx-auto mt-14 w-full max-w-6xl px-4 pb-12 sm:mt-16 sm:px-6 sm:pb-16">
          <div className="relative mr-[12%] sm:mr-[10%] lg:mr-0">
            <BrowserFrame url="sollos3.com/app">
              <Image
                src={dashboardShot}
                alt="The Sollos dashboard: today's revenue, this week's jobs and revenue, outstanding invoices, a Needs-you list and today's jobs with their cleaners."
                sizes="(min-width: 1152px) 1104px, 88vw"
                loading="eager"
                fetchPriority="high"
                placeholder="blur"
                className="h-auto w-full"
              />
            </BrowserFrame>
            <PhoneFrame className="absolute -bottom-8 -right-[11%] w-[31%] max-w-[260px] sm:-bottom-12 sm:-right-[8%] sm:w-[24%] lg:-right-10">
              <Image
                src={fieldJobShot}
                alt="The cleaner's phone app on a job in progress: on the clock for 2 hours 6 minutes, an I'm done button, the address and the client's number."
                sizes="(min-width: 1024px) 260px, 31vw"
                placeholder="blur"
                className="h-auto w-full"
              />
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* ── Made for ─────────────────────────────────────────────────── */}
      <section aria-label="Who it's for" className="border-y border-zinc-100 bg-zinc-50/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 py-6 sm:flex-row sm:justify-center sm:gap-5 sm:px-6">
          <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-500">Made for</p>
          <ul className="flex flex-wrap justify-center gap-2">
            {LANDING_PAGES.map((l) => (
              <li key={l.slug}>
                <Link
                  href={`/${l.slug}`}
                  className="inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                >
                  {l.navLabel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Before / after ───────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow>Why Sollos</Eyebrow>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
              You&apos;re running this on six apps and a group chat.
            </h2>
            <p className="mt-4 text-pretty text-base leading-7 text-zinc-600">
              Most cleaning companies grow into a patchwork: a booking app meant for hair salons, an invoicing tool
              that doesn&apos;t know what a recurring clean is, a spreadsheet for hours. We built Sollos because that
              was us, too.
            </p>
          </div>
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white lg:col-span-7">
            {PAIN_POINTS.map((p) => (
              <li key={p.before} className="grid gap-2 p-5 sm:grid-cols-2 sm:gap-6">
                <p className="flex items-start gap-2.5 text-sm text-zinc-500">
                  <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" aria-hidden />
                  <span>
                    <span className="sr-only">Without Sollos: </span>
                    {p.before}
                  </span>
                </p>
                <p className="flex items-start gap-2.5 text-sm font-medium text-zinc-900">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  <span>
                    <span className="sr-only">With Sollos: </span>
                    {p.after}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Product tour ─────────────────────────────────────────────── */}
      <section id="features" className="scroll-mt-20 border-t border-zinc-100 bg-gradient-to-b from-zinc-50/80 to-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <SectionHeading
            eyebrow="The office"
            title="Everything your office does, on one screen"
            body="Scheduling, bookings, invoices and payroll share one record of every job, so nothing gets typed twice and nothing falls between apps."
          />
          <div className="mt-16 space-y-20 sm:mt-20 sm:space-y-28">
            <TourRow
              icon={CalendarDays}
              eyebrow="Scheduling"
              title="See the whole week. Move a job with a drag."
              body="Every cleaner's week on one board, with the money that week is worth. Drag a booking to another cleaner or another day and the whole job moves with it."
              bullets={[
                "Drag bookings between cleaners and days",
                "Recurring clients fill their own visits in",
                "Unassigned shifts are flagged before they're missed",
              ]}
              shot={schedulingShot}
              alt="The scheduling board for one week: a row per cleaner, a card per booking with time, length and status, and a revenue strip showing scheduled, earned and remaining."
            />
            <TourRow
              reverse
              icon={ListChecks}
              eyebrow="Bookings"
              title="Every job, its crew, its status and its price."
              body="Upcoming, today and past in one list you can search. Change the crew from the row, see which visits belong to a recurring series, and keep the gate code with the job."
              bullets={[
                "Weekly, every-two-weeks and custom repeats",
                "Crews of one or five, with hours split evenly if you like",
                "Client notes travel with every visit",
              ]}
              shot={bookingsShot}
              alt="The bookings list: date and time, client with notes, service, duration, assigned cleaners, status and total for each job."
            />
            <TourRow
              icon={Receipt}
              eyebrow="Invoices & payments"
              title="Invoice the moment the job is done."
              body="Finished jobs turn into invoices on their own if you want them to, with your tax on top. Clients pay by card from a link, and the invoice shows what was billed next to what the crew actually clocked."
              bullets={[
                "Automatic invoices when a job is marked done",
                "A pay-by-card link in the invoice email (via Stripe)",
                "An hours check on every invoice before it goes out",
              ]}
              shot={invoiceShot}
              alt="An invoice: total, paid, balance and due date, send-again and public-link buttons, line items with GST, and an hours check comparing booked and clocked time."
              frameUrl="sollos3.com/app/invoices"
            />
            <TourRow
              reverse
              icon={Wallet}
              eyebrow="Payroll & timesheets"
              title="Payroll that adds itself up."
              body="Clock-ins become hours, hours meet each cleaner's rate, and the pay period is ready to run. Employees and subcontractors are kept apart, and anything odd is flagged before you pay it."
              bullets={[
                "Hours straight from on-site clock-ins",
                "Weekly, every two weeks, twice a month or monthly",
                "Shifts nobody clocked out of are held for review",
              ]}
              shot={payrollShot}
              alt="The payroll page: the next pay period with unpaid hours, wages waiting and people, a flagged shift to review, and totals for employees and contractors."
            />
          </div>
        </div>
      </section>

      {/* ── Field app ────────────────────────────────────────────────── */}
      <section id="field-app" className="scroll-mt-20 bg-zinc-950 text-white">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">The field</p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
              An app your cleaners will actually use.
            </h2>
            <p className="mt-4 text-pretty text-base leading-7 text-zinc-400">
              Their day on their phone: where to go, what to do there, and one big button when they&apos;re done.
              Nothing to download from an app store — it opens in the browser and sits on the home screen like any
              other app.
            </p>
            <ul className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {FIELD_POINTS.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-white">{f.title}</p>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-7">
            <div className="mx-auto grid max-w-[560px] grid-cols-3 items-start gap-3 sm:gap-5">
              <PhoneFrame className="mt-10 ring-white/10">
                <Image
                  src={fieldTodayShot}
                  alt="The cleaner's Today screen: one job in progress, on the clock, with an I'm done button."
                  sizes="(min-width: 1024px) 180px, 30vw"
                  placeholder="blur"
                  className="h-auto w-full"
                />
              </PhoneFrame>
              <PhoneFrame className="ring-white/10">
                <Image
                  src={fieldJobShot}
                  alt="A job on the cleaner's phone: time on the clock, I'm done, the address with Open in Maps, and the client's phone number."
                  sizes="(min-width: 1024px) 180px, 30vw"
                  placeholder="blur"
                  className="h-auto w-full"
                />
              </PhoneFrame>
              <PhoneFrame className="mt-16 ring-white/10">
                <Image
                  src={fieldClockShot}
                  alt="The Clock screen: on the clock since 12:26 PM, location recorded for payroll, and the last seven days of shifts."
                  sizes="(min-width: 1024px) 180px, 30vw"
                  placeholder="blur"
                  className="h-auto w-full"
                />
              </PhoneFrame>
            </div>
          </div>
        </div>
      </section>

      {/* ── Everything else ──────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading
          eyebrow="And the rest"
          title="Everything else that comes with running a cleaning company"
          body="No add-ons, no second subscription. All of it is in every plan."
        />
        <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-4">
          {MORE_FEATURES.map((f) => (
            <li key={f.title} className="bg-white p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100">
                <f.icon className="h-[18px] w-[18px] text-zinc-800" aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-zinc-600">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-zinc-100 bg-zinc-50/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHeading
            eyebrow="Getting started"
            title="Up and running this afternoon"
            body="No demos, no sales calls, no 90-day onboarding. Sign up and go."
          />
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-zinc-200 bg-white p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-zinc-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Security ─────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-4">
            <Eyebrow>Your data</Eyebrow>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-[-0.02em]">Your data stays yours.</h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Your client list is your business. We never sell it, share it, or use it for anything but running the
              product.
            </p>
            <Link
              href="/security"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-zinc-900 hover:underline"
            >
              How we protect it <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
            {TRUST_ITEMS.map((t) => (
              <li key={t.title} className="flex gap-4 rounded-2xl border border-zinc-200 p-5">
                <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-zinc-800" aria-hidden />
                <div>
                  <h3 className="text-sm font-semibold">{t.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">{t.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 border-t border-zinc-100 bg-gradient-to-b from-zinc-50/80 to-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <SectionHeading
            eyebrow="Pricing"
            title="One price. Every feature. No surprises."
            body="Pick the plan that fits the size of your team. Try it free for 14 days, no card required."
          />
          <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-3">
            {PLANS.map((p) => {
              const featured = p.name === "Team";
              return (
                <div
                  key={p.name}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-white p-6",
                    featured ? "border-zinc-900 shadow-xl shadow-zinc-900/10" : "border-zinc-200",
                  )}
                >
                  {featured && (
                    <span className="absolute -top-3 left-6 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  <p className="mt-1 text-sm text-zinc-600">{p.tagline}</p>
                  <p className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">${p.price}</span>
                    <span className="text-sm text-zinc-500">/month</span>
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm text-zinc-700">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                      <span>
                        Up to <strong className="font-semibold text-zinc-900">{p.cleaners} cleaners</strong>
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                      {p.texts} texts a month included
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                      {p.name === "Growth" ? "Priority support and an onboarding call" : "Email support"}
                    </li>
                  </ul>
                  <Link
                    href="/signup"
                    className={cn(
                      buttonVariants({ size: "lg", variant: featured ? "default" : "outline" }),
                      "mt-8 h-11 w-full rounded-full text-sm font-semibold",
                      !featured && "border-zinc-200",
                    )}
                  >
                    Start 14-day trial
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="mx-auto mt-5 max-w-5xl rounded-2xl border border-zinc-200 bg-white p-6">
            <p className="text-sm font-semibold">Every plan includes</p>
            <ul className="mt-4 grid gap-x-6 gap-y-2.5 text-sm text-zinc-700 sm:grid-cols-2 lg:grid-cols-4">
              {PLAN_INCLUDES.map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto mt-5 flex max-w-5xl flex-col gap-4 rounded-2xl bg-zinc-100 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">More than 25 cleaners?</p>
              <p className="mt-1 text-sm text-zinc-600">
                Enterprise: unlimited team size, a dedicated account manager and custom integrations.
              </p>
            </div>
            <a
              href="mailto:sales@sollos3.com?subject=Enterprise%20inquiry"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 shrink-0 rounded-full border-zinc-300 bg-white px-5 text-sm font-semibold",
              )}
            >
              Contact sales
            </a>
          </div>

          <p className="mt-6 text-center text-sm text-zinc-500">
            Prices in US dollars.{" "}
            <Link href="/pricing" className="font-semibold text-zinc-900 hover:underline">
              Compare every plan →
            </Link>
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-[-0.02em]">Questions, answered straight</h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Something not covered here? Email{" "}
              <a href="mailto:hello@sollos3.com" className="font-medium text-zinc-900 underline underline-offset-2">
                hello@sollos3.com
              </a>{" "}
              and a real person will answer.
            </p>
          </div>
          <div className="divide-y divide-zinc-200 border-y border-zinc-200 lg:col-span-8">
            {FAQS.map((item) => (
              <details key={item.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[15px] font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="relative h-4 w-4 shrink-0 text-zinc-400 before:absolute before:left-0 before:top-1/2 before:h-[1.5px] before:w-4 before:-translate-y-1/2 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-4 after:w-[1.5px] after:-translate-x-1/2 after:bg-current after:transition-transform group-open:after:scale-y-0"
                  />
                </summary>
                <p className="pb-5 pr-8 text-sm leading-7 text-zinc-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="relative overflow-hidden rounded-3xl bg-zinc-950 px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(99,102,241,0.35),transparent_70%)]"
          />
          <h2 className="relative text-balance text-3xl font-bold tracking-[-0.02em] text-white sm:text-4xl">
            Ready to stop juggling spreadsheets?
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg text-base leading-7 text-zinc-400">
            Try every feature free for 14 days. No credit card, no contracts, no sales calls.
          </p>
          <div className="relative mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
            >
              Start 14-day free trial
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}

/* ---------- Pieces ---------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{children}</p>;
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-balance text-3xl font-bold tracking-[-0.02em] sm:text-4xl">{title}</h2>
      <p className="mt-4 text-pretty text-base leading-7 text-zinc-600">{body}</p>
    </div>
  );
}

function TourRow({
  icon: Icon,
  eyebrow,
  title,
  body,
  bullets,
  shot,
  alt,
  reverse = false,
  frameUrl,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  shot: StaticImageData;
  alt: string;
  reverse?: boolean;
  frameUrl?: string;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
      <div className={cn("lg:col-span-5", reverse && "lg:order-2")}>
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600">
          <Icon className="h-4 w-4" aria-hidden />
          {eyebrow}
        </p>
        <h3 className="mt-3 text-balance text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{title}</h3>
        <p className="mt-4 text-pretty text-base leading-7 text-zinc-600">{body}</p>
        <ul className="mt-6 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-sm text-zinc-700">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn("lg:col-span-7", reverse && "lg:order-1")}>
        <BrowserFrame url={frameUrl ?? `sollos3.com/app/${eyebrow.split(" ")[0].toLowerCase()}`}>
          <Image src={shot} alt={alt} sizes="(min-width: 1152px) 640px, (min-width: 1024px) 56vw, 92vw" placeholder="blur" className="h-auto w-full" />
        </BrowserFrame>
      </div>
    </div>
  );
}

/* ---------- Content ---------- */

/** "The way it usually is" → "the way it should be". */
const PAIN_POINTS = [
  {
    before: "A cleaner texts at 7 AM that they can't make the 9 AM job",
    after: "Text the open shift to your subcontractor bench. Filled in minutes.",
  },
  {
    before: "Three sticky notes for one client's gate code and pets",
    after: "Every client's preferences, codes and notes in one record.",
  },
  {
    before: "Chasing invoices by phone three weeks after the job",
    after: "The invoice goes out when the job is done, with a pay-by-card link.",
  },
  {
    before: "Payroll math at midnight in a spreadsheet",
    after: "Hours and rates tracked per cleaner. Payroll runs in minutes.",
  },
  {
    before: "Personal phone numbers in a group text with employees",
    after: "Built-in team chat. Numbers stay private.",
  },
  {
    before: "No idea a job happened until the complaint",
    after: "Cleaners clock in on site with location. You see who's where.",
  },
];

const FIELD_POINTS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: MapPin, title: "Clock in on site", body: "Location is recorded at clock-in and out, for payroll." },
  { icon: ClipboardCheck, title: "Checklists", body: "Room by room, with the steps you require." },
  { icon: Camera, title: "Before and after photos", body: "Taken on the job, kept with the visit." },
  { icon: MessageSquare, title: "Team chat", body: "Talk to the office without sharing numbers." },
];

const MORE_FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: UserPlus,
    title: "Subcontractor bench",
    body: "Someone called out? Text your trusted freelancers; the first to tap the link gets the job.",
  },
  {
    icon: CalendarCheck,
    title: "Google Calendar sync",
    body: "Jobs go to your Google Calendar, and your own events show beside your jobs.",
  },
  {
    icon: Users,
    title: "Client records",
    body: "Address, contacts, history, documents and notes for every client, in one place.",
  },
  {
    icon: Inbox,
    title: "Client portal & requests",
    body: "Clients ask for a visit, see their invoices and pay without calling you.",
  },
  {
    icon: FileSignature,
    title: "Estimates & contracts",
    body: "Send an estimate to a new lead and turn the accepted one into a job with a click.",
  },
  {
    icon: Star,
    title: "Reviews",
    body: "Ask for a review after the job and see satisfaction by cleaner.",
  },
  {
    icon: Clock,
    title: "Timesheets",
    body: "Every shift with its clock-in and out, and the ones that need a second look.",
  },
  {
    icon: Smartphone,
    title: "Works on any device",
    body: "Laptop at the office, phone on the road. Nothing to install.",
  },
];

const STEPS = [
  {
    title: "Create your workspace",
    body: "Sign up with your email and name your company. It takes about a minute.",
  },
  {
    title: "Add your team and clients",
    body: "Invite your cleaners, import your client list from a spreadsheet, set up your services.",
  },
  {
    title: "Book your first job",
    body: "Schedule it, assign the crew, and the invoice follows when it's done.",
  },
];

const TRUST_ITEMS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Lock,
    title: "Walled off from everyone else",
    body: "Each company's data is isolated in the database itself. Only you and your team can see it.",
  },
  {
    icon: ShieldCheck,
    title: "Never sold, never shared",
    body: "We don't sell your data, share it with advertisers, or use it to train AI.",
  },
  {
    icon: DatabaseBackup,
    title: "Backed up every day",
    body: "Automatic daily backups, so a client record or an invoice is never lost.",
  },
  {
    icon: Download,
    title: "Take it with you",
    body: "Download a full copy of your account whenever you like, from Settings.",
  },
];

const PLAN_INCLUDES = [
  "Unlimited clients, jobs and invoices",
  "Scheduling and recurring visits",
  "The field app for every cleaner",
  "Clock-in, timesheets and payroll",
  "Online card payments",
  "Team chat",
  "Subcontractor bench texts",
  "Google Calendar sync",
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
    q: "What if my team is bigger than 25 cleaners?",
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
