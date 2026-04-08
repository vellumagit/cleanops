import Link from "next/link";
import { Award, ChevronRight } from "lucide-react";
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
