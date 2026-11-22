import Link from "next/link";
import {
  Award,
  Bell,
  BellRing,
  Clock,
  Banknote,
  Lightbulb,
  ChevronRight,
  Coins,
  CreditCard,
  Database,
  Globe2,
  KeyRound,
  Mail,
  MessageSquare,
  Palette,
  Plug,
  Repeat,
  ScrollText,
  Shield,
  Sparkles,
  User,
  Users,
  Webhook,
  Inbox,
  Zap,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { PwaInstallCard } from "@/components/pwa-install-button";

export const metadata = { title: "Settings" };

type Section = {
  title: string;
  description: string;
  items: Array<{
    href: string;
    icon: typeof Users;
    title: string;
    description: string;
  }>;
};

/**
 * Grouped by what you're trying to change, not by how the code is built.
 * Until 2026-11-21 an "Automations" group held invoicing and payroll pages,
 * the automation timings sat under Team, lead alerts under Integrations, and
 * payment instructions under Business, a group away from card payments —
 * Brian: settings "scattered all over seemingly randomly". Now every switch
 * lives on the page about its subject, and each group answers one question.
 */
const SECTIONS: Section[] = [
  {
    title: "Your company",
    description: "Who you are and how amounts, dates and services read everywhere.",
    items: [
      {
        href: "/app/settings/email",
        icon: Mail,
        title: "Email & contact info",
        description:
          "The name your emails come from, and the contact email and phone clients see on invoices.",
      },
      {
        href: "/app/settings/branding",
        icon: Palette,
        title: "Branding",
        description:
          "Logo + brand colour for invoices, booking confirmations, and public pages.",
      },
      {
        href: "/app/settings/services",
        icon: Sparkles,
        title: "Services",
        description:
          "The list of services that show up when booking — rename the defaults, archive ones you don't offer, add your own.",
      },
      {
        href: "/app/settings/timezone",
        icon: Globe2,
        title: "Timezone",
        description:
          "Booking times and recurring schedules are read in this zone.",
      },
      {
        href: "/app/settings/currency",
        icon: Coins,
        title: "Currency, tax & holidays",
        description:
          "How amounts display, the default GST / VAT / sales tax, and which region's statutory holidays mark the scheduler.",
      },
    ],
  },
  {
    title: "Clients",
    description: "What clients hear from you, and how new ones reach you.",
    items: [
      {
        href: "/app/settings/automations",
        icon: Zap,
        title: "Client messages",
        description:
          "Confirmations, reminders, invoice chasers and review asks, in the order a job happens — plus who receives them. The automations master switch is here.",
      },
      {
        href: "/app/settings/sms",
        icon: MessageSquare,
        title: "SMS / Texting",
        description:
          "Text clients from your own number. Included in your plan up to a monthly limit.",
      },
      {
        href: "/app/settings/intake-forms",
        icon: Inbox,
        title: "Website & lead forms",
        description:
          "Connect your website, social and hiring forms so inquiries land in Sollos, and choose how you're alerted to new leads.",
      },
    ],
  },
  {
    title: "Money",
    description: "Invoices going out and payments coming in.",
    items: [
      {
        href: "/app/settings/invoicing",
        icon: CreditCard,
        title: "Invoicing",
        description:
          "Drafting invoices when jobs finish, sending them for you, the morning review, and auto-void.",
      },
      {
        href: "/app/settings/recurring-invoices",
        icon: Repeat,
        title: "Recurring invoices",
        description:
          "Invoices on a schedule for clients on a retainer or contract.",
      },
      {
        href: "/app/settings/payment-methods",
        icon: Banknote,
        title: "Getting paid",
        description:
          "Card payments, the payment instructions on every invoice (e-transfer, cheque, wire), and tips.",
      },
    ],
  },
  {
    title: "Team",
    description: "Your people, their pay, and what Sollos tells them.",
    items: [
      {
        href: "/app/settings/members",
        icon: Users,
        title: "Team members",
        description:
          "Everyone on your team with their role and pay rate. Invite or add people from Employees.",
      },
      {
        href: "/app/settings/payroll",
        icon: Clock,
        title: "Payroll & timesheets",
        description:
          "The pay-period calendar, forgotten clock-outs, overtime, and pay receipts.",
      },
      {
        href: "/app/settings/bonus-rules",
        icon: Award,
        title: "Bonus rules",
        description:
          "Rating thresholds that earn employees a performance bonus.",
      },
      {
        href: "/app/settings/team-alerts",
        icon: BellRing,
        title: "Team alerts & housekeeping",
        description:
          "Crew schedules, nudges to the office, digests, and the bookkeeping Sollos does for you — auto-complete, auto-expire, auto-archive.",
      },
    ],
  },
  {
    title: "Connections",
    description: "Sollos and the rest of your tools.",
    items: [
      {
        href: "/app/settings/integrations",
        icon: Plug,
        title: "Integrations",
        description:
          "Stripe, Square, QuickBooks, Sage, Google Calendar — card payments and books in sync.",
      },
      {
        href: "/app/settings/api-keys",
        icon: KeyRound,
        title: "API Keys",
        description:
          "Keys for Make.com, Zapier, n8n, or custom integrations that need read / write access.",
      },
      {
        href: "/app/settings/webhooks",
        icon: Webhook,
        title: "Webhooks",
        description:
          "Send real-time events to other systems when bookings, invoices, or reviews change.",
      },
    ],
  },
  {
    title: "Account",
    description: "Your Sollos plan, the record of changes, and your data.",
    items: [
      {
        href: "/app/settings/billing",
        icon: CreditCard,
        title: "Billing",
        description:
          "Your Sollos plan, payment method, and invoices for the platform itself.",
      },
      {
        href: "/app/settings/audit-log",
        icon: ScrollText,
        title: "Audit log",
        description:
          "Who created, updated, deleted, or paid what across your company.",
      },
      {
        href: "/app/settings/data",
        icon: Database,
        title: "Your data",
        description:
          "Export everything your company owns. Schedule permanent deletion with a 30-day grace window.",
      },
    ],
  },
  {
    title: "You",
    description: "Just your own login — nobody else's changes.",
    items: [
      {
        href: "/app/profile",
        icon: User,
        title: "Your profile",
        description:
          "Your own name and phone — how you appear on bookings, the schedule, and to your team.",
      },
      {
        href: "/app/profile/security",
        icon: Shield,
        title: "Security",
        description:
          "Two-step sign-in on your own login. Recommended for owners and admins.",
      },
      {
        href: "/app/notifications/choices",
        icon: Bell,
        title: "What alerts you",
        description:
          "Which notices buzz your phone and reach your email.",
      },
      {
        href: "/app/settings/tips",
        icon: Lightbulb,
        title: "Tips & shortcuts",
        description:
          "Type-to-jump dropdowns, batch billing, one-tap fixes — and the switch for inline tips.",
      },
    ],
  },
];

export default async function SettingsPage() {
  await requireMembership(["owner", "admin"]);
  return (
    <PageShell
      title="Settings"
      description="Grouped by what you're changing: your company, clients, money, your team, connections, and your account."
    >
      <PwaInstallCard />

      <div className="mt-4 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <div className="mb-2">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <p className="text-xs text-muted-foreground">
                {section.description}
              </p>
            </div>
            <ul className="grid gap-2 xl:grid-cols-2">
              {section.items.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      className="flex h-full items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium">{s.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.description}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
