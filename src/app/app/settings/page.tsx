import Link from "next/link";
import {
  Award,
  Banknote,
  ChevronRight,
  Coins,
  CreditCard,
  KeyRound,
  Mail,
  Palette,
  Plug,
  ScrollText,
  Users,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { PwaInstallCard } from "@/components/pwa-install-button";

export const metadata = { title: "Settings" };

const SECTIONS = [
  {
    href: "/app/settings/members",
    icon: Users,
    title: "Team members",
    description:
      "Manage roles, pay rates, and access for everyone on your team.",
  },
  {
    href: "/app/settings/branding",
    icon: Palette,
    title: "Branding",
    description:
      "Upload your logo and set your brand colour for invoices and public pages.",
  },
  {
    href: "/app/settings/currency",
    icon: Coins,
    title: "Currency",
    description:
      "Choose whether amounts display in Canadian or US dollars.",
  },
  {
    href: "/app/settings/email",
    icon: Mail,
    title: "Email",
    description:
      "Set the sender address for invoices, confirmations, and notifications.",
  },
  {
    href: "/app/settings/bonus-rules",
    icon: Award,
    title: "Bonus rules",
    description:
      "Set the rating thresholds that earn employees a performance bonus.",
  },
  {
    href: "/app/settings/audit-log",
    icon: ScrollText,
    title: "Audit log",
    description:
      "Append-only record of who created, updated, deleted or paid what.",
  },
  {
    href: "/app/settings/integrations",
    icon: Plug,
    title: "Integrations",
    description:
      "Connect Stripe, Square, or QuickBooks so customers can pay online.",
  },
  {
    href: "/app/settings/api-keys",
    icon: KeyRound,
    title: "API Keys",
    description:
      "Generate keys to connect Make.com, Zapier, n8n, or custom integrations.",
  },
  {
    href: "/app/settings/payment-methods",
    icon: Banknote,
    title: "Payment instructions",
    description:
      "Zelle, check, wire — what your clients see on their invoice.",
  },
  {
    href: "/app/settings/billing",
    icon: CreditCard,
    title: "Billing",
    description:
      "Plan, payment method, and Stripe customer portal (scaffolded).",
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

      <ul className="space-y-2 mt-4">
        {SECTIONS.map((s) => {
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
    </PageShell>
  );
}
