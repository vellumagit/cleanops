import Link from "next/link";
import { ChevronLeft, Zap } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import {
  AudienceBadge,
  AutomationStageList,
  INTERNAL_STAGES,
  MasterSwitchBanner,
  OtherAutomationPages,
  QuietModeCard,
} from "@/app/app/settings/automations/automation-catalog";
import {
  EMPTY_THRESHOLDS,
  THRESHOLD_SELECT,
  type ThresholdValues,
} from "@/app/app/settings/thresholds/threshold-fields";

export const metadata = { title: "Team alerts & housekeeping" };

/**
 * Settings → Team alerts & housekeeping: the automations that never reach a
 * client — crew schedules, nudges to the office, digests, and the background
 * bookkeeping (auto-complete, auto-expire, auto-archive). Split off the
 * Automations page on 2026-11-21, which now holds client messages only. The
 * timing for these (how many hours before a job is completed for you, how
 * many days before records archive) sits under each switch instead of on a
 * page of its own.
 */
export default async function TeamAlertsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data: org } = (await admin
    .from("organizations")
    .select(`automation_settings, automations_enabled, quiet_mode, ${THRESHOLD_SELECT}`)
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data:
      | ({
          automation_settings: Record<string, { enabled: boolean }>;
          automations_enabled: boolean | null;
          quiet_mode: boolean | null;
        } & ThresholdValues)
      | null;
  };

  const settings = org?.automation_settings ?? {};
  const masterOn = org?.automations_enabled === true;
  const enabledCount = Object.values(settings).filter(
    (v) => (v as { enabled?: boolean })?.enabled === true,
  ).length;

  return (
    <PageShell
      title="Team alerts & housekeeping"
      description="Crew schedules, nudges to the office, digests, and the bookkeeping Sollos does for you. None of these reach a client."
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      <MasterSwitchBanner masterOn={masterOn} enabledCount={enabledCount} />
      <QuietModeCard quiet={org?.quiet_mode === true} />
      <OtherAutomationPages current="team" />

      <div className="mb-6 grid gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-1">
          <AudienceBadge audience="team" />
          <p className="text-[11px] text-muted-foreground">
            Goes to you or your staff — an email, a push, or a notice.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1">
          <AudienceBadge audience="background" />
          <p className="text-[11px] text-muted-foreground">
            Does the bookkeeping — completes, expires or archives records.
            Sends nothing to anyone.
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground sm:col-span-2">
          Which of the office alerts reach <em>you</em> personally is your own
          choice, under{" "}
          <Link href="/app/notifications/choices" className="underline underline-offset-2">
            What alerts you
          </Link>
          . These switches decide whether Sollos sends them at all.
        </p>
      </div>

      <section>
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/15">
            <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Grouped by when they happen</h2>
            <p className="text-xs text-muted-foreground">
              Where one has a timing setting, it appears under the switch once
              it&apos;s on.
            </p>
          </div>
        </div>
        <AutomationStageList
          stages={INTERNAL_STAGES}
          settings={settings}
          masterOn={masterOn}
          thresholds={org ?? EMPTY_THRESHOLDS}
        />
      </section>
    </PageShell>
  );
}
