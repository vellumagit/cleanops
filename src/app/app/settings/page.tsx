import Link from "next/link";
import {
  Award,
  Banknote,
  ChevronRight,
  CreditCard,
  Plug,
  ScrollText,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Settings" };

const SECTIONS = [
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

export default function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      description="Organization, members, billing, and integrations."
    >
      <ul className="space-y-2">
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
