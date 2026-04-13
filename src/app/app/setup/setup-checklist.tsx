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

const STEPS: StepDef[] = [
  {
    key: "hasClient",
    title: "Add your first client",
    description:
      "Clients are who you clean for. Add one so you can start booking jobs.",
    href: "/app/clients/new",
    cta: "Add a client",
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
    title: "Create a booking",
    description:
      "Schedule a cleaning job — pick a client, date, and assign a team member.",
    href: "/app/bookings/new",
    cta: "Create a booking",
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
      "Bring your cleaners on board. They'll get a mobile app to view jobs, clock in, and chat.",
    href: "/app/employees",
    cta: "Invite an employee",
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
  {
    key: "hasBranding",
    title: "Add your brand",
    description:
      "Upload your logo and pick a colour. Your brand appears on invoices and public links.",
    href: "/app/settings/branding",
    cta: "Set up branding",
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
    title: "Set up payment instructions",
    description:
      "Tell clients how to pay — Zelle, check, wire, Venmo. Shows on every invoice.",
    href: "/app/settings/payment-methods",
    cta: "Add payment info",
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
      "Create an invoice for a completed job and share the payment link with your client.",
    href: "/app/invoices/new",
    cta: "Create an invoice",
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

export function SetupChecklist({
  steps,
  orgName,
}: {
  steps: Steps;
  orgName: string;
}) {
  const completed = STEPS.filter((s) => steps[s.key]).length;
  const total = STEPS.length;
  const allDone = completed === total;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Welcome header */}
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight">
          {allDone ? "You're ready to go" : `Welcome to ${orgName}`}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {allDone
            ? "Everything is set up. Head to the dashboard to start managing your business."
            : "Complete these steps to get the most out of Sollos."}
        </p>

        {/* Colourful progress bar */}
        <div className="mt-5 inline-flex items-center gap-3 rounded-full border border-border bg-card px-5 py-2.5 shadow-sm">
          <div className="flex gap-1.5">
            {STEPS.map((step) => (
              <div
                key={step.key}
                className={cn(
                  "h-2 w-8 rounded-full transition-all duration-500",
                  steps[step.key] ? step.color.bar : "bg-muted",
                )}
              />
            ))}
          </div>
          <span className="text-xs font-semibold text-foreground tabular-nums">
            {completed}/{total}
          </span>
          <span className="text-xs text-muted-foreground">complete</span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const done = steps[step.key];
          const Icon = step.icon;

          return (
            <Link
              key={step.key}
              href={done ? "#" : step.href}
              className={cn(
                "group flex items-center gap-4 rounded-xl border p-4 transition-all",
                done
                  ? `${step.color.doneBorder} ${step.color.doneBg}`
                  : "border-border bg-card shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 hover:-translate-y-0.5",
              )}
              tabIndex={done ? -1 : undefined}
            >
              {/* Step number / check — colour-coded */}
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-all",
                  done
                    ? `${step.color.bar} text-white shadow-sm`
                    : `border-2 ${step.color.numberBorder} ${step.color.number}`,
                )}
              >
                {done ? (
                  <Check className="h-5 w-5" strokeWidth={3} />
                ) : (
                  idx + 1
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3
                    className={cn(
                      "text-sm font-semibold",
                      done ? step.color.doneText : "text-foreground",
                    )}
                  >
                    {step.title}
                  </h3>
                  {!done && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        step.color.iconBg,
                        step.color.icon,
                      )}
                    >
                      {step.cta}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.description}
                </p>
              </div>

              {/* Icon / arrow */}
              <div className="shrink-0">
                {done ? (
                  <Icon
                    className={cn("h-5 w-5", step.color.doneText, "opacity-40")}
                  />
                ) : (
                  <ArrowRight className="h-5 w-5 text-muted-foreground/30 transition-all group-hover:translate-x-1 group-hover:text-foreground" />
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Finish / Skip */}
      <div className="flex flex-col items-center gap-2 pt-2">
        <form action={completeOnboardingAction}>
          {allDone ? (
            <Button
              size="lg"
              className="gap-2 px-8 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white shadow-lg shadow-indigo-500/25 border-0"
            >
              <Sparkles className="h-4 w-4" />
              Go to dashboard
            </Button>
          ) : (
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
