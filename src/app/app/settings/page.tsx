import Link from "next/link";
import {
  Award,
  Banknote,
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
  Sliders,
  Sparkles,
  Users,
  Webhook,
  Inbox,
  Zap,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { PwaInstallCard } from "@/components/pwa-install-button";

export const metadata = { title: "Settings" };

/**
 * Settings grouped into thematic sections so owners can find what
 * they need without scanning 16 rows. Order inside each group goes
 * from most-often-touched at the top (what clients see / what
 * affects money) to infrequent admin tools at the bottom.
 */
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

const SECTIONS: Section[] = [
  {
    title: "Business",
    description: "What shows up on invoices, emails, and public pages.",
    items: [
      {
        href: "/app/settings/services",
        icon: Sparkles,
        title: "Services",
        description:
          "The list of services that show up when booking — rename the defaults, archive ones you don't offer, add your own.",
      },
      {
        href: "/app/settings/branding",
        icon: Palette,
        title: "Branding",
        description:
          "Logo + brand colour for invoices, booking confirmations, and public pages.",
      },
      {
        href: "/app/settings/email",
        icon: Mail,
        title: "Email & contact info",
        description:
          "Sender email for outgoing mail + the contact email / phone shown to clients on invoices.",
      },
      {
        href: "/app/settings/sms",
        icon: MessageSquare,
        title: "SMS / Texting",
        description:
          "Text booking confirmations and reminders to clients from your own dedicated number. Included in your plan up to a monthly limit.",
      },
      {
        href: "/app/settings/currency",
        icon: Coins,
        title: "Currency & tax",
        description:
          "How amounts display + the default GST / VAT / sales tax applied to new invoices.",
      },
      {
        href: "/app/settings/timezone",
        icon: Globe2,
        title: "Timezone",
        description:
          "Your org's timezone. Booking times and recurrence schedules are interpreted in this zone.",
      },
      {
        href: "/app/settings/payment-methods",
        icon: Banknote,
        title: "Payment instructions",
        description:
          "Zelle, check, wire — what clients see on their invoice when online payment isn't set up.",
      },
    ],
  },
  {
    title: "Team",
    description: "Members, compensation, and thresholds.",
    items: [
      {
        href: "/app/settings/members",
        icon: Users,
        title: "Team members",
        description:
          "Invite, add manually, and manage roles + pay rates for everyone on your team.",
      },
      {
        href: "/app/settings/bonus-rules",
        icon: Award,
        title: "Bonus rules",
        description:
          "Rating thresholds that earn employees a performance bonus.",
      },
      {
        href: "/app/settings/thresholds",
        icon: Sliders,
        title: "Automation thresholds",
        description:
          "Tune timing on the hygiene crons: when to expire estimates, void invoices, archive records, and the overtime warning threshold.",
      },
    ],
  },
  {
    title: "Automations",
    description: "Background work that runs without you clicking.",
    items: [
      {
        href: "/app/settings/automations",
        icon: Zap,
        title: "Automations",
        description:
          "Toggle which automations fire — client emails, team notifications, owner alerts, housekeeping.",
      },
      {
        href: "/app/settings/invoicing",
        icon: CreditCard,
        title: "Invoicing",
        description:
          "Auto-send drafted invoices after a review window (per-job + biweekly/monthly), with a hold / send-now escape hatch.",
      },
      {
        href: "/app/settings/recurring-invoices",
        icon: Repeat,
        title: "Recurring invoices",
        description:
          "Auto-generate invoices on a schedule for contract clients on a retainer.",
      },
    ],
  },
  {
    title: "Integrations",
    description: "Connect Sollos to the rest of your stack.",
    items: [
      {
        href: "/app/settings/integrations",
        icon: Plug,
        title: "Integrations",
        description:
          "Connect Stripe, Square, QuickBooks, Google Calendar — so clients can pay online and your books stay in sync.",
      },
      {
        href: "/app/settings/api-keys",
        icon: KeyRound,
        title: "API Keys",
        description:
          "Generate keys for Make.com, Zapier, n8n, or custom integrations that need read / write access.",
      },
      {
        href: "/app/settings/webhooks",
        icon: Webhook,
        title: "Webhooks (outbound)",
        description:
          "POST real-time events to external systems when bookings, invoices, or reviews change.",
      },
      {
        href: "/app/settings/intake-forms",
        icon: Inbox,
        title: "Intake forms (inbound)",
        description:
          "Get a webhook URL to paste into your hiring or lead forms — submissions land in Sollos automatically.",
      },
    ],
  },
  {
    title: "Account",
    description: "Subscription, audit trail, and your data.",
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
          "Append-only record of who created, updated, deleted, or paid what across your org.",
      },
      {
        href: "/app/settings/data",
        icon: Database,
        title: "Your data",
        description:
          "Export everything your org owns. Schedule permanent deletion with a 30-day grace window.",
      },
      {
        href: "/app/profile/security",
        icon: Shield,
        title: "Security (your account)",
        description:
          "Enable multi-factor authentication on your own login. Optional but recommended for owners and admins.",
      },
    ],
  },
];

export default async function SettingsPage() {
  await requireMembership(["owner", "admin"]);
  return (
    <PageShell
      title="Settings"
      description="Organization, members, billing, and integrations."
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
            <ul className="space-y-2">
              {section.items.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
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
