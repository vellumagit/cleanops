import Link from "next/link";
import { ChevronLeft, CalendarRange, Sparkles, Clock } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import type { PaySchedule } from "@/lib/pay-schedule";
import { PayScheduleForm } from "./pay-schedule-form";
import { SatelliteAutomations } from "@/app/app/settings/automations/satellite-automations";
import { PAYROLL_AUTOMATIONS } from "@/app/app/settings/automations/satellite-registry";

export const metadata = { title: "Payroll & timesheets" };

/**
 * One home for the pay-period machinery — the calendar that Payroll's
 * "Up next" card, the morning autodraft, and the Timesheets pager all
 * follow. Brian: "consolidate everything that has to do with that
 * underneath the automation section."
 */
export default async function PayrollSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data: org } = (await admin
    .from("organizations")
    .select("pay_schedule, pay_anchor" as never)
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { pay_schedule: string | null; pay_anchor: string | null } | null;
  };

  return (
    <PageShell
      title="Payroll & timesheets"
      description="The pay-period calendar, and everything that follows it."
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
      }
    >
      <div className="max-w-2xl space-y-6">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarRange className="h-4 w-4" />
            Pay period schedule
          </h2>
          <p className="mt-1 mb-5 text-xs text-muted-foreground">
            Pick the calendar your pay periods follow. Manual means you choose
            dates by hand each time.
          </p>
          <PayScheduleForm
            schedule={(org?.pay_schedule ?? null) as PaySchedule | null}
            anchor={org?.pay_anchor ?? null}
          />
        </section>

        <section className="rounded-lg border border-border bg-muted/20 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What this one setting drives
          </h2>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex items-start gap-2.5">
              <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <Link href="/app/payroll" className="font-medium underline underline-offset-2">
                  Payroll
                </Link>{" "}
                suggests the last completed period on this calendar — no more
                typing dates.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">The morning autodraft</span> —
                with a schedule set, the day after a period ends Sollos
                prepares it (employee run + contractor statement together) and
                notifies you it&rsquo;s ready for review. Nothing is ever paid
                automatically.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <Link href="/app/timesheets" className="font-medium underline underline-offset-2">
                  Timesheets
                </Link>{" "}
                opens on the current period with ‹ › arrows stepping through
                the same windows — reviewing hours and paying them share one
                calendar.
              </span>
            </li>
          </ul>
        </section>

        <SatelliteAutomations
          title="Payroll & timesheet automations"
          items={PAYROLL_AUTOMATIONS}
        />
      </div>
    </PageShell>
  );
}
