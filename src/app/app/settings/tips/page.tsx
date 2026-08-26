import { Lightbulb } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { TipsToggle } from "@/components/tip";
import { TIPS } from "@/lib/tips";

export const metadata = { title: "Tips & shortcuts" };

/**
 * The master list of every fast path the app supports, plus the toggle for
 * the inline lightbulb chips. The list renders regardless of the toggle —
 * turning chips off shouldn't hide the knowledge, just the decoration.
 */
export default async function TipsSettingsPage() {
  await requireMembership(["owner", "admin", "manager"]);

  return (
    <PageShell
      title="Tips & shortcuts"
      description="The fast paths — every one of these works right now."
    >
      <div className="max-w-2xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="sollos-label mb-3">Inline tips</p>
          <TipsToggle />
          <p className="mt-2 text-xs text-muted-foreground">
            When on, small lightbulbs appear next to controls that have a
            trick worth knowing. Tap one to read it. This list stays here
            either way.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <p className="sollos-label">All shortcuts</p>
          </div>
          <ul className="divide-y divide-border">
            {TIPS.map((t) => (
              <li key={t.key} className="flex gap-3 px-5 py-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500/80" />
                <div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PageShell>
  );
}
