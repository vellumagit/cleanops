"use client";

import Link from "next/link";
import {
  Users,
  Calendar,
  UserPlus,
  Banknote,
  Palette,
  Receipt,
  Check,
  ArrowRight,
  Sparkles,
  ChevronDown,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { completeOnboardingAction } from "./actions";

type Steps = {
  hasClient: boolean;
  hasBooking: boolean;
  hasTeam: boolean;
  hasBranding: boolean;
  hasPaymentInstructions: boolean;
  hasInvoice: boolean;
};

type StepDef = {
  key: keyof Steps;
  title: string;
  description: string;
  href: string;
  cta: string;
  /** How long this step realistically takes — sets commitment expectations. */
  time: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Colour theme for this step */
  color: {
    icon: string;
    iconBg: string;
    doneBg: string;
    doneBorder: string;
    doneText: string;
    bar: string;
    number: string;
    numberBorder: string;
  };
};

// --- Essential steps — the three things that must happen before Sollos
// is useful. You can't run a cleaning business without clients, jobs,
// and the crew that does them.
const ESSENTIAL_STEPS: StepDef[] = [
  {
    key: "hasClient",
    title: "Add your first client",
    description:
      "Every job is attached to a client — this is who you'll bill. Name, address, phone. Takes a sec.",
    href: "/app/clients/new?from=setup",
    cta: "Add client",
    time: "30 sec",
    icon: Users,
    color: {
      icon: "text-sky-500",
      iconBg: "bg-sky-500/10",
      doneBg: "bg-sky-50 dark:bg-sky-950/20",
      doneBorder: "border-sky-200 dark:border-sky-900/40",
      doneText: "text-sky-700 dark:text-sky-400",
      bar: "bg-sky-500",
      number: "text-sky-500",
      numberBorder: "border-sky-200 dark:border-sky-800",
    },
  },
  {
    key: "hasBooking",
    title: "Schedule a cleaning job",
    description:
      "Pick a client, pick a date, and assign a team member. The moment you save, your crew sees it on their phone.",
    href: "/app/bookings/new?from=setup",
    cta: "Book a job",
    time: "1 min",
    icon: Calendar,
    color: {
      icon: "text-violet-500",
      iconBg: "bg-violet-500/10",
      doneBg: "bg-violet-50 dark:bg-violet-950/20",
      doneBorder: "border-violet-200 dark:border-violet-900/40",
      doneText: "text-violet-700 dark:text-violet-400",
      bar: "bg-violet-500",
      number: "text-violet-500",
      numberBorder: "border-violet-200 dark:border-violet-800",
    },
  },
  {
    key: "hasTeam",
    title: "Invite your team",
    description:
      "Your cleaners get a free mobile app to see their jobs, clock in and out, chat with you, and mark work done.",
    href: "/app/employees?from=setup",
    cta: "Send invite",
    time: "1 min",
    icon: UserPlus,
    color: {
      icon: "text-amber-500",
      iconBg: "bg-amber-500/10",
      doneBg: "bg-amber-50 dark:bg-amber-950/20",
      doneBorder: "border-amber-200 dark:border-amber-900/40",
      doneText: "text-amber-700 dark:text-amber-400",
      bar: "bg-amber-500",
      number: "text-amber-500",
      numberBorder: "border-amber-200 dark:border-amber-800",
    },
  },
];

// --- Polish steps — what makes you look like a real business when
// clients see your invoices and payment links. Nice-to-have, not
// required to start working.
const POLISH_STEPS: StepDef[] = [
  {
    key: "hasBranding",
    title: "Add your logo & brand color",
    description:
      "Shows up on every invoice and client link. Five minutes here makes you look as legit as the big guys.",
    href: "/app/settings/branding?from=setup",
    cta: "Add branding",
    time: "2 min",
    icon: Palette,
    color: {
      icon: "text-pink-500",
      iconBg: "bg-pink-500/10",
      doneBg: "bg-pink-50 dark:bg-pink-950/20",
      doneBorder: "border-pink-200 dark:border-pink-900/40",
      doneText: "text-pink-700 dark:text-pink-400",
      bar: "bg-pink-500",
      number: "text-pink-500",
      numberBorder: "border-pink-200 dark:border-pink-800",
    },
  },
  {
    key: "hasPaymentInstructions",
    title: "Tell clients how to pay you",
    description:
      "Zelle, check, Venmo, bank transfer — whatever you accept. We print this on every invoice so clients know where to send money.",
    href: "/app/settings/payment-methods?from=setup",
    cta: "Add payment info",
    time: "1 min",
    icon: Banknote,
    color: {
      icon: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
      doneBg: "bg-emerald-50 dark:bg-emerald-950/20",
      doneBorder: "border-emerald-200 dark:border-emerald-900/40",
      doneText: "text-emerald-700 dark:text-emerald-400",
      bar: "bg-emerald-500",
      number: "text-emerald-500",
      numberBorder: "border-emerald-200 dark:border-emerald-800",
    },
  },
  {
    key: "hasInvoice",
    title: "Send your first invoice",
    description:
      "Run through the full flow once — pick a completed job, review, send. Client gets a link they can pay online.",
    href: "/app/invoices/new?from=setup",
    cta: "Create invoice",
    time: "2 min",
    icon: Receipt,
    color: {
      icon: "text-orange-500",
      iconBg: "bg-orange-500/10",
      doneBg: "bg-orange-50 dark:bg-orange-950/20",
      doneBorder: "border-orange-200 dark:border-orange-900/40",
      doneText: "text-orange-700 dark:text-orange-400",
      bar: "bg-orange-500",
      number: "text-orange-500",
      numberBorder: "border-orange-200 dark:border-orange-800",
    },
  },
];

const ALL_STEPS = [...ESSENTIAL_STEPS, ...POLISH_STEPS];

export function SetupChecklist({
  steps,
  orgName,
  firstName,
}: {
  steps: Steps;
  orgName: string;
  firstName: string | null;
}) {
  const essentialDone = ESSENTIAL_STEPS.filter((s) => steps[s.key]).length;
  const polishDone = POLISH_STEPS.filter((s) => steps[s.key]).length;
  const totalDone = essentialDone + polishDone;
  const essentialsComplete = essentialDone === ESSENTIAL_STEPS.length;
  const allDone = totalDone === ALL_STEPS.length;

  const greeting = firstName ? `Welcome, ${firstName}.` : "Welcome.";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Hero */}
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
          {allDone ? "You're all set" : greeting}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {allDone ? (
            <>Everything&rsquo;s configured. Head to the dashboard to start running the business.</>
          ) : essentialsComplete ? (
            <>
              The essentials are done — <strong className="text-foreground">{orgName}</strong> is
              ready to work. A few polish items left to look fully professional.
            </>
          ) : (
            <>
              Let&rsquo;s get <strong className="text-foreground">{orgName}</strong> up and running
              in about 5 minutes.
            </>
          )}
        </p>

        {/* Progress pill */}
        <div className="mt-4 inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-sm">
          <div className="flex gap-1">
            {ALL_STEPS.map((step) => (
              <div
                key={step.key}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-all duration-500",
                  steps[step.key] ? step.color.bar : "bg-muted",
                )}
              />
            ))}
          </div>
          <span className="text-xs font-semibold text-foreground tabular-nums">
            {totalDone}/{ALL_STEPS.length}
          </span>
        </div>
      </div>

      {/* 60-second primer — collapsed by default so we don't overwhelm, but
          there for anyone who wants the big picture before they start. */}
      {!allDone && (
        <details className="group rounded-xl border border-border bg-card/60 p-4 shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-foreground list-none">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              New to Sollos? Here&rsquo;s how it works in 60 seconds
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <ol className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="shrink-0 font-semibold text-sky-500">1.</span>
              <span>
                <strong className="text-foreground">Add your clients.</strong> These are the
                people you clean for. Every job and every invoice gets tied to a client.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-semibold text-violet-500">2.</span>
              <span>
                <strong className="text-foreground">Book your jobs.</strong> Pick a date, pick a
                cleaner, and it&rsquo;s on their calendar. One-time or recurring.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-semibold text-amber-500">3.</span>
              <span>
                <strong className="text-foreground">Your crew works the mobile app.</strong>{" "}
                They see today&rsquo;s jobs, clock in and out, take before/after photos, and
                mark work complete.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-semibold text-emerald-500">4.</span>
              <span>
                <strong className="text-foreground">Invoice and get paid.</strong> One click
                turns a finished job into an invoice. Client pays online or however you set up.
              </span>
            </li>
          </ol>
        </details>
      )}

      {/* Essentials section */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Start here
          </h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {essentialDone}/{ESSENTIAL_STEPS.length}
          </span>
        </div>
        {ESSENTIAL_STEPS.map((step, idx) => (
          <StepRow key={step.key} step={step} idx={idx + 1} done={steps[step.key]} />
        ))}
      </section>

      {/* Polish section — visually secondary so it doesn't feel required */}
      <section className="space-y-3 rounded-xl bg-muted/30 p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Look professional
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Optional, but do these before you send a client anything.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {polishDone}/{POLISH_STEPS.length}
          </span>
        </div>
        {POLISH_STEPS.map((step, idx) => (
          <StepRow
            key={step.key}
            step={step}
            idx={ESSENTIAL_STEPS.length + idx + 1}
            done={steps[step.key]}
          />
        ))}
      </section>

      {/* Finish / Skip */}
      <div className="flex flex-col items-center gap-2 pt-2">
        <form action={completeOnboardingAction}>
          {allDone || essentialsComplete ? (
            <Button
              type="submit"
              size="lg"
              className={cn(
                "gap-2 px-8 text-white border-0 shadow-lg",
                allDone
                  ? "bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 shadow-indigo-500/25"
                  : "bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-600 hover:to-violet-600 shadow-sky-500/25",
              )}
            >
              <Sparkles className="h-4 w-4" />
              {allDone ? "Go to dashboard" : "I'm ready — go to dashboard"}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="link"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              Skip setup for now
            </Button>
          )}
        </form>
        {essentialsComplete && !allDone && (
          <p className="text-[11px] text-muted-foreground">
            You can always come back here later from the sidebar.
          </p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function StepRow({
  step,
  idx,
  done,
}: {
  step: StepDef;
  idx: number;
  done: boolean;
}) {
  const Icon = step.icon;

  return (
    <Link
      href={step.href}
      className={cn(
        "group flex items-center gap-4 rounded-xl border p-4 transition-all",
        done
          ? `${step.color.doneBorder} ${step.color.doneBg} hover:shadow-sm`
          : "border-border bg-card shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:hover:border-slate-600",
      )}
    >
      {/* Step number / check */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-all",
          done
            ? `${step.color.bar} text-white shadow-sm`
            : `border-2 ${step.color.numberBorder} ${step.color.number}`,
        )}
      >
        {done ? <Check className="h-5 w-5" strokeWidth={3} /> : idx}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={cn(
              "text-sm font-semibold",
              done ? step.color.doneText : "text-foreground",
            )}
          >
            {step.title}
          </h3>
          {!done && (
            <>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  step.color.iconBg,
                  step.color.icon,
                )}
              >
                {step.cta}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {step.time}
              </span>
            </>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {step.description}
        </p>
      </div>

      {/* Icon / arrow */}
      <div className="shrink-0">
        {done ? (
          <Icon className={cn("h-5 w-5", step.color.doneText, "opacity-40")} />
        ) : (
          <ArrowRight className="h-5 w-5 text-muted-foreground/30 transition-all group-hover:translate-x-1 group-hover:text-foreground" />
        )}
      </div>
    </Link>
  );
}
