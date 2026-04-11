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
  },
  {
    key: "hasBooking",
    title: "Create a booking",
    description:
      "Schedule a cleaning job — pick a client, date, and assign a team member.",
    href: "/app/bookings/new",
    cta: "Create a booking",
    icon: Calendar,
  },
  {
    key: "hasTeam",
    title: "Invite your team",
    description:
      "Bring your cleaners on board. They'll get a mobile app to view jobs, clock in, and chat.",
    href: "/app/employees",
    cta: "Invite an employee",
    icon: UserPlus,
  },
  {
    key: "hasBranding",
    title: "Add your brand",
    description:
      "Upload your logo and pick a colour. Your brand appears on invoices and public links.",
    href: "/app/settings/branding",
    cta: "Set up branding",
    icon: Palette,
  },
  {
    key: "hasPaymentInstructions",
    title: "Set up payment instructions",
    description:
      "Tell clients how to pay — Zelle, check, wire, Venmo. Shows on every invoice.",
    href: "/app/settings/payment-methods",
    cta: "Add payment info",
    icon: Banknote,
  },
  {
    key: "hasInvoice",
    title: "Send your first invoice",
    description:
      "Create an invoice for a completed job and share the payment link with your client.",
    href: "/app/invoices/new",
    cta: "Create an invoice",
    icon: Receipt,
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
          {allDone
            ? "You're ready to go"
            : `Welcome to ${orgName}`}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {allDone
            ? "Everything is set up. Head to the dashboard to start managing your business."
            : "Complete these steps to get the most out of Sollos."}
        </p>

        {/* Step count */}
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5">
          <div className="flex gap-1">
            {STEPS.map((step) => (
              <div
                key={step.key}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  steps[step.key] ? "bg-emerald-500" : "bg-muted",
                )}
              />
            ))}
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {completed}/{total}
          </span>
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
                "group flex items-center gap-4 rounded-lg border p-4 transition-all",
                done
                  ? "border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/30 dark:bg-emerald-950/10"
                  : "border-border bg-card shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600",
              )}
              tabIndex={done ? -1 : undefined}
            >
              {/* Step number / check */}
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  done
                    ? "bg-emerald-500 text-white"
                    : "border-2 border-slate-200 text-slate-400 dark:border-slate-700",
                )}
              >
                {done ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : (
                  idx + 1
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3
                  className={cn(
                    "text-sm font-semibold",
                    done
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-foreground",
                  )}
                >
                  {step.title}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.description}
                </p>
              </div>

              {/* Icon / arrow */}
              <div className="shrink-0">
                {done ? (
                  <Icon className="h-5 w-5 text-emerald-300 dark:text-emerald-700" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
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
            <Button size="lg" className="gap-2 px-8">
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
