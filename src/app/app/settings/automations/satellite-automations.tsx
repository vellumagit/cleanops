import Link from "next/link";
import { Zap } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import {
  resolveAutomationEnabled,
  automationAudience,
  type AutomationAudience,
} from "@/lib/automation-defaults";
import { resolveClockOutThresholds } from "@/lib/shift-overrun";
import { toggleAutomationAction, type AutomationKey } from "./actions";
import { ClockOutThresholds } from "./clock-out-thresholds";
import type { SatelliteAutomation } from "./satellite-registry";

const AUDIENCE_STYLE: Record<
  AutomationAudience,
  { label: string; pill: string; dot: string }
> = {
  client: {
    label: "Client message",
    pill: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    dot: "bg-sky-500",
  },
  team: {
    label: "Team alert",
    pill: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  background: {
    label: "Background",
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

/**
 * A domain page's own automations — the same toggles, the same action, the
 * same master switch as Settings → Automations, just living where their
 * subject lives (Brian: "move the internal stuff to where it needs to
 * live"). The master switch stays global: when it's off, these show a
 * banner pointing home rather than pretending to be independent.
 */
export async function SatelliteAutomations({
  title,
  items,
}: {
  title: string;
  items: SatelliteAutomation[];
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  const { data: org } = (await admin
    .from("organizations")
    .select("automation_settings, automations_enabled")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      automation_settings: Record<string, { enabled?: boolean }> | null;
      automations_enabled: boolean | null;
    } | null;
  };
  const settings = org?.automation_settings ?? {};
  const masterOn = org?.automations_enabled === true;
  const clockOutThresholds = resolveClockOutThresholds(
    org?.automation_settings ?? null,
  );

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Zap className="h-4 w-4" />
        {title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Part of your automations — moved here to live beside what they act
        on. The{" "}
        <Link
          href="/app/settings/automations"
          className="underline underline-offset-2"
        >
          master switch
        </Link>{" "}
        still governs them.
      </p>

      {!masterOn && (
        <p className="mt-3 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          The automations master switch is off — nothing below runs until you{" "}
          <Link
            href="/app/settings/automations"
            className="font-semibold underline underline-offset-2"
          >
            turn it on
          </Link>
          .
        </p>
      )}

      <ul
        className={`mt-4 divide-y divide-border/60 ${masterOn ? "" : "pointer-events-none opacity-50"}`}
      >
        {items.map((a) => {
          const on = resolveAutomationEnabled(settings, a.key);
          const audience = automationAudience(a.key);
          const s = AUDIENCE_STYLE[audience];
          return (
            <li key={a.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{a.title}</span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.pill}`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${s.dot}`}
                      />
                      {s.label}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {a.trigger}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.description}
                  </p>
                </div>
                <form action={toggleAutomationAction} className="shrink-0">
                  <input
                    type="hidden"
                    name="key"
                    value={a.key as AutomationKey}
                  />
                  <input
                    type="hidden"
                    name="enabled"
                    value={on ? "false" : "true"}
                  />
                  <SubmitButton
                    variant={on ? "default" : "outline"}
                    size="sm"
                    pendingLabel={on ? "Disabling…" : "Enabling…"}
                  >
                    {on ? "Enabled" : "Disabled"}
                  </SubmitButton>
                </form>
              </div>
              {a.key === "shift_clock_out_reminder" && on && (
                <ClockOutThresholds
                  graceMinutes={clockOutThresholds.graceMinutes}
                  reminderIntervalMinutes={
                    clockOutThresholds.reminderIntervalMinutes
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
