import Link from "next/link";
import {
  ArrowRight,
  Check,
  CreditCard,
  Building2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for Sollos 3. Start with a 14-day free trial — no credit card required.",
};

export default function PricingPage() {
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
            href="/"
            className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Home
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

      {/* Header */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pt-16 pb-12 text-center">
        <div className="sollos-kicker inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <CreditCard className="h-3 w-3 text-emerald-500" />
          Pricing
        </div>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
          One price. Every feature.
          <br />
          No surprises.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Pick the plan that fits your team. Every plan includes every feature.
          Try it free for 14 days — no credit card required.
        </p>
      </section>

      {/* Pricing tiers */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
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
                "Freelancer bench SMS",
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
              <ArrowRight className="ml-1.5 h-4 w-4" />
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

      {/* Comparison table */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-16">
        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold tracking-tight">
            Compare plans
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every feature, side by side.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 pr-4 font-semibold">Feature</th>
                  <th className="py-3 px-3 text-center font-semibold">Starter</th>
                  <th className="py-3 px-3 text-center font-semibold">Growth</th>
                  <th className="py-3 pl-3 text-center font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature}>
                    <td className="py-3 pr-4 text-muted-foreground">{row.feature}</td>
                    <td className="py-3 px-3 text-center">
                      <FeatureCell value={row.starter} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <FeatureCell value={row.growth} />
                    </td>
                    <td className="py-3 pl-3 text-center">
                      <FeatureCell value={row.enterprise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Frequently asked questions
        </h2>

        <div className="mt-8 space-y-4">
          {FAQS.map((faq) => (
            <div key={faq.q} className="rounded-lg border border-border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground">{faq.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Still have questions?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          The fastest way to see if Sollos is right for you is to try it. 14 days free, no card required.
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
            href="mailto:hello@sollos3.com"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              "rounded-full border-border bg-white px-6 text-sm font-semibold shadow-sm hover:bg-muted",
            )}
          >
            Email us
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border bg-white/50 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Sollos 3
            </p>
            <nav className="flex items-center gap-4 text-xs text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
              <span>·</span>
              <Link href="/terms" className="hover:text-foreground">Terms</Link>
              <span>·</span>
              <Link href="mailto:hello@sollos3.com" className="hover:text-foreground">Contact</Link>
            </nav>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) {
    return <Check className="mx-auto h-4 w-4 text-emerald-500" />;
  }
  if (value === false) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  return <span className="text-xs font-medium text-foreground">{value}</span>;
}

const COMPARISON_ROWS: Array<{
  feature: string;
  starter: boolean | string;
  growth: boolean | string;
  enterprise: boolean | string;
}> = [
  { feature: "Employees", starter: "Up to 5", growth: "Up to 25", enterprise: "Unlimited" },
  { feature: "Clients and jobs", starter: "Unlimited", growth: "Unlimited", enterprise: "Unlimited" },
  { feature: "Invoicing and payments", starter: true, growth: true, enterprise: true },
  { feature: "Team chat", starter: true, growth: true, enterprise: true },
  { feature: "Clock-in and timesheets", starter: true, growth: true, enterprise: true },
  { feature: "Freelancer bench SMS", starter: true, growth: true, enterprise: true },
  { feature: "Google Calendar sync", starter: true, growth: true, enterprise: true },
  { feature: "Client records and history", starter: true, growth: true, enterprise: true },
  { feature: "Estimates and quotes", starter: true, growth: true, enterprise: true },
  { feature: "Payroll reports", starter: true, growth: true, enterprise: true },
  { feature: "Custom branding on invoices", starter: false, growth: true, enterprise: true },
  { feature: "Bulk data import", starter: false, growth: true, enterprise: true },
  { feature: "Advanced reports and exports", starter: false, growth: true, enterprise: true },
  { feature: "Onboarding call", starter: false, growth: true, enterprise: true },
  { feature: "Email support", starter: true, growth: "Priority", enterprise: "Priority" },
  { feature: "Phone support", starter: false, growth: false, enterprise: true },
  { feature: "Dedicated account manager", starter: false, growth: false, enterprise: true },
  { feature: "SSO (single sign-on)", starter: false, growth: false, enterprise: true },
  { feature: "Custom integrations", starter: false, growth: false, enterprise: true },
  { feature: "SLA and uptime guarantees", starter: false, growth: false, enterprise: true },
];

const FAQS = [
  {
    q: "Do I need a credit card to start my trial?",
    a: "No. You can start your 14-day free trial with just your email and company name. We'll only ask for a card when you pick a plan at the end of the trial.",
  },
  {
    q: "What happens when my trial ends?",
    a: "You'll get reminders a few days before your trial ends. When it does, you can pick a plan to keep using Sollos, or your account pauses. Your data stays safe for 30 days either way.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes, upgrade or downgrade anytime from your account settings. Upgrades take effect immediately (prorated for the current month). Downgrades take effect at the end of your billing cycle.",
  },
  {
    q: "What counts as an employee?",
    a: "Anyone on your team who has a login to Sollos — owners, managers, and cleaners. Freelancers on your freelancer bench do NOT count as employees, since they don't have Sollos logins.",
  },
  {
    q: "What if I have more than 25 employees?",
    a: "That's what Enterprise is for. Reach out at sales@sollos3.com and we'll set you up with a plan that fits your size and needs.",
  },
  {
    q: "Is there a contract or long-term commitment?",
    a: "Nope. All plans are month-to-month. Cancel anytime from your account settings — no phone calls, no retention tricks.",
  },
  {
    q: "Can I export my data if I cancel?",
    a: "Absolutely. You can export everything — clients, jobs, invoices, timesheets — to CSV anytime, even before you cancel. When you do cancel, you have 30 days to export before your data is deleted.",
  },
  {
    q: "Do you offer annual billing?",
    a: "Yes, contact us for annual pricing and we'll give you 2 months free (pay for 10, get 12).",
  },
  {
    q: "Is my data secure?",
    a: "Yes. Your data is stored encrypted, isolated from every other company on the platform, and backed up daily. See our Privacy Policy for the full details.",
  },
  {
    q: "Do you integrate with QuickBooks / Xero / Stripe?",
    a: "Stripe is already built in for accepting payments. QuickBooks and Xero integrations are on our roadmap. Enterprise plans can request custom integrations.",
  },
];
