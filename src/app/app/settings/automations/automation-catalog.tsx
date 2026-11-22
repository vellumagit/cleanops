import Link from "next/link";
import {
  ChevronDown,
  Zap,
  Users,
  Clock,
  Star,
  Receipt,
  FileText,
  CalendarPlus,
} from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import {
  resolveAutomationEnabled,
  CLIENT_FACING_AUTOMATION_KEYS,
  automationAudience,
  type AutomationAudience,
} from "@/lib/automation-defaults";
import {
  reviewAskFrequency,
  REVIEW_ASK_FREQUENCY_OPTIONS,
  REBOOKING_FREQUENCY_OPTIONS,
  rebookingGapDays,
} from "@/lib/review-cadence";
import { AutomationFrequencySelect } from "./review-frequency-select";
import {
  toggleAutomationAction,
  toggleAutomationsMasterAction,
  applyAutomationPresetAction,
  type AutomationKey,
} from "./actions";
import {
  THRESHOLD_FOR_AUTOMATION,
  type ThresholdValues,
} from "@/app/app/settings/thresholds/threshold-fields";
import { ThresholdInline } from "@/app/app/settings/thresholds/threshold-inline";

/**
 * The automation catalogue and the pieces both automation pages draw with.
 *
 * Settings → Client messages (/app/settings/automations) shows the client
 * half; Settings → Team alerts & housekeeping (/app/settings/team-alerts)
 * shows the rest. They were one long page until 2026-11-21; Brian found
 * automations "scattered all over seemingly randomly", and a page that holds
 * two audiences under a title naming one was part of that. One catalogue, so
 * the two pages can never disagree about which automation is which.
 */

export type AutomationDef = {
  key: AutomationKey;
  title: string;
  description: string;
  trigger: string;
};

export type Stage = {
  id: string;
  label: string;
  /** Plain-English outcome — what happens in this moment when things are on. */
  outcome: string;
  icon: typeof Zap;
  automations: AutomationDef[];
  /** Show a one-click "turn all of these on" bundle button (safe stages only). */
  bundlePreset?: string;
};

/**
 * The three-kind doctrine, made visible. Every toggle wears one of these so
 * an owner always knows WHO an automation touches before flipping it:
 * client message (per-client rules apply), team alert (staff only), or
 * background (bookkeeping — sends nothing). Derived from the same sets the
 * engine enforces, so the label can never drift from the behavior.
 */
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

export function AudienceBadge({ audience }: { audience: AutomationAudience }) {
  const s = AUDIENCE_STYLE[audience];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.pill}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/**
 * Automations organized by the LIFE OF A JOB, not by channel or recipient.
 * Owners think in moments — "someone books, they get confirmed, reminded the
 * day before, invoiced when it's done" — so the page tells that story in
 * order. Every automation lives in exactly one stage.
 */
export const STAGES: Stage[] = [
  {
    id: "winning",
    label: "Winning the work",
    outcome: "Sent estimates get followed up, and stale ones expire on their own.",
    icon: FileText,
    automations: [
      {
        key: "estimate_followup_email",
        title: "Estimate follow-up",
        description:
          "7 days after sending an estimate that hasn't been approved or declined, emails the client a 'still interested?' check-in. A second 'last chance' email fires at 14 days before the estimate auto-expires at day 30.",
        trigger: "Daily scan at 09:30 UTC",
      },
      {
        key: "auto_booking_on_estimate_approval",
        title: "Draft a booking when an estimate is approved",
        description:
          "When you mark an estimate approved, creates a PENDING placeholder booking linked to it (tomorrow 9 AM, unassigned) so scheduling the job can't be forgotten. You still pick the real date, time, and cleaner. No client messages are sent for the placeholder.",
        trigger: "Estimate → Approved",
      },
      {
        key: "stale_estimate_alert",
        title: "Stale-estimate alert to you",
        description:
          "Pings owners/admins (in-app + one aggregate push) when an estimate has sat in Sent for 7+ days with no decision, so follow-up doesn't slip.",
        trigger: "Daily scan at 09:00 UTC",
      },
      {
        key: "auto_expire_stale_estimates",
        title: "Auto-expire stale estimates",
        description:
          "Flips estimates in Sent status with no answer to Expired once they pass the number of days set below (30 unless you change it), so your estimates list stays focused on live opportunities.",
        trigger: "Daily at 03:00 UTC",
      },
    ],
  },
  {
    id: "booked",
    label: "When a job is booked",
    outcome:
      "The client gets confirmed, the crew gets notified, and changes or cancellations are announced.",
    icon: CalendarPlus,
    automations: [
      {
        key: "booking_confirmation_email",
        title: "Booking confirmation email",
        description:
          "Sends the client an email when a new booking is created or confirmed for them.",
        trigger: "Booking → Created",
      },
      {
        key: "booking_confirmation_sms",
        title: "Booking confirmation text",
        description:
          "Texts the client when a new booking is confirmed, with the service type, date, and a contact number. Requires Twilio + the client's SMS opt-in.",
        trigger: "Booking → Created",
      },
      {
        key: "booking_rescheduled_email",
        title: "Booking rescheduled email",
        description:
          "Emails the client when a booking's scheduled time changes, showing both the old and new slot.",
        trigger: "Booking → Rescheduled",
      },
      {
        key: "booking_rescheduled_sms",
        title: "Booking rescheduled text",
        description:
          "Texts the client the new time when a booking moves. Replaces the rescheduled email for clients who've opted in to texts — one notice, not both.",
        trigger: "Booking → Rescheduled",
      },
      {
        key: "booking_cancelled_email",
        title: "Booking cancelled email",
        description:
          "Emails the client when a booking's status flips to cancelled. The assigned employee is pushed separately so they don't show up.",
        trigger: "Booking → Cancelled",
      },
      {
        key: "booking_cancelled_sms",
        title: "Booking cancelled text",
        description:
          "Texts the client when their visit is cancelled. Replaces the cancellation email for opted-in clients — one notice, not both.",
        trigger: "Booking → Cancelled",
      },
      {
        key: "booking_assignment_notify",
        title: "Notify employee on booking assignment",
        description:
          "Sends a push notification to the assigned employee when a booking is assigned to them.",
        trigger: "Booking → Assigned",
      },
      {
        key: "booking_assignment_sms",
        title: "Job assignment text to employee",
        description:
          "Texts the assigned employee when a booking is assigned to them. Field crews check SMS more reliably than push — a no-show is worse than a spammy text.",
        trigger: "Booking → Assigned",
      },
      {
        key: "unassigned_booking_alert",
        title: "Unassigned booking alert",
        description:
          "Emails owners/admins when a booking is within 24 hours and still has no cleaner assigned. Silent on days where everything is staffed — no empty alerts.",
        trigger: "Daily scan at 22:00 UTC",
      },
    ],
  },
  {
    id: "daybefore",
    label: "The day before",
    outcome: "The client gets a heads-up so nobody is surprised at the door.",
    icon: Clock,
    automations: [
      {
        key: "booking_reminder_client_email",
        title: "24-hour booking reminder to client",
        description:
          "Emails the client roughly 24 hours before their booking with a heads-up about the service, time, and address. Sent at most once per booking.",
        trigger: "Daily cron, ~18:00 UTC",
      },
      {
        key: "booking_reminder_client_sms",
        title: "24-hour booking reminder text",
        description:
          "Texts the client roughly 24 hours before their booking. Sent alongside the email reminder — the text gets the nudge noticed; the email carries the address and details.",
        trigger: "Daily cron, ~18:00 UTC",
      },
    ],
  },
  {
    id: "paid",
    label: "Job done & getting paid",
    outcome:
      "Finished jobs close out, invoices draft themselves, overdue ones get chased, receipts go out.",
    icon: Receipt,
    automations: [
      {
        key: "shift_confirm_reminder",
        title: "Shift still unconfirmed",
        description:
          "Asks a cleaner to confirm a shift they haven't answered — once the day before, and again two hours before it starts. At that second nudge you're told too: \"Anna hasn't confirmed today's 3:00 PM at Amanda DeGroot\", so you can check with them or reassign while there's still time. Each nudge is sent once per shift.",
        trigger: "24 hours and 2 hours before an unconfirmed shift",
      },
      {
        key: "job_not_started_nudge",
        title: "Nobody clocked in yet",
        description:
          "Nudges the assigned cleaner when a job's start time has passed and nobody has clocked in — while showing up is still possible. Goes to the crew, not to you; someone running fifteen minutes late isn't news. Sent once per job.",
        trigger: "15 minutes after a job's start time",
      },
      {
        key: "no_clock_in_alert",
        title: "Job finished with no clock-in",
        description:
          "Tells you when a job's whole window has passed with somebody assigned but no clock-in at all — no evidence the work happened. Arrives before auto-complete turns it into an invoice, so you can confirm or cancel it first. One alert covering every such job, sent once each. Silent if your team doesn't use clock-in.",
        trigger: "30 minutes after a job's expected end",
      },
      {
        key: "auto_complete_past_bookings",
        title: "Auto-complete past bookings",
        description:
          "Marks bookings still in Pending or Confirmed status as Completed once their scheduled time is further in the past than the hours set below (24 unless you change it). Prevents ghost jobs cluttering the list.",
        trigger: "Daily at 02:00 UTC",
      },
      {
        key: "invoice_overdue_reminder",
        title: "Overdue invoice reminder",
        description:
          "Sends the client a polite reminder once every 7 days while an invoice is past due. Stops automatically once the invoice is marked paid.",
        trigger: "Invoice → Overdue (daily cron)",
      },
      {
        key: "invoice_paid_receipt",
        title: "Receipt + review request on payment",
        description:
          "Sends the client a payment receipt and a link to leave a review after their invoice is marked paid.",
        trigger: "Invoice → Paid",
      },
    ],
  },
  {
    id: "growing",
    label: "Growing the business",
    outcome:
      "Happy clients get asked for reviews, quiet ones get a gentle nudge to rebook.",
    icon: Star,
    automations: [
      {
        key: "review_request_after_completion",
        title: "Internal review request",
        description:
          "Emails the client a Sollos-hosted review link after a completed booking — at most as often as the cadence below, and never within the same window as a review they already left. Clients can always volunteer a review from their portal (every finished visit has a link); the cadence only limits the ASKING. Powers the dashboard rating, per-employee scores, and bonus rules.",
        trigger: "Daily cron, ~10:00 UTC",
      },
      {
        key: "gbp_review_request",
        title: "Google review request — 48h after first job, 1 week, then monthly",
        description:
          "Emails the client a Google review link 48 hours after their FIRST completed booking. If they haven't clicked: a reminder 1 week later, then monthly until the cap (4 more by default). Stops the moment they click. Requires your Google Review URL in Settings → Branding.",
        trigger: "Daily cron, ~11:00 UTC",
      },
      {
        key: "rebooking_prompt_email",
        title: "Rebooking prompt",
        description:
          "14+ days after a completed job, if the client has no future booking on the calendar, emails them a friendly 'ready for your next clean?' nudge — at most as often as the cadence below, per client.",
        trigger: "Daily scan at 15:00 UTC",
      },
    ],
  },
  {
    id: "office",
    label: "Team alerts & housekeeping",
    outcome:
      "Crew schedules, owner digests, and housekeeping. None of these touch your clients — safe to turn on as a bundle.",
    icon: Users,
    bundlePreset: "team_office",
    automations: [
      {
        key: "job_starting_soon_push",
        title: "Job starting soon push to employee",
        description:
          "Pushes the assigned cleaner shortly before a job's start time — a last-line 'you're up' nudge on top of the daily schedule email.",
        trigger: "Hourly scan",
      },
      {
        key: "employee_daily_schedule",
        title: "Employee daily schedule",
        description:
          "Morning email to each cleaner with every job on their plate today — time, client, address, duration, and per-job notes.",
        trigger: "Daily at 06:00 UTC",
      },
      {
        key: "employee_weekly_schedule",
        title: "Employee weekly schedule",
        description:
          "Sunday-night preview of the week ahead for each cleaner. Sets expectations before Monday morning.",
        trigger: "Sundays at 18:00 UTC",
      },
      {
        key: "training_assigned_notify",
        title: "Training assignment email",
        description:
          "Emails the employee when a new training module is assigned to them, with a direct link to start.",
        trigger: "Training → Assigned",
      },
      {
        key: "certification_expiry_reminder",
        title: "Certification expiry reminder",
        description:
          "Emails the employee 30 days and 7 days before a completed training certification expires, with a link to retake.",
        trigger: "Daily scan at 14:00 UTC",
      },
      {
        key: "review_submitted_notify",
        title: "Notify admin on new review",
        description:
          "Sends an in-app notification to owners and admins when a client submits a review.",
        trigger: "Review → Submitted",
      },
      {
        key: "low_review_alert",
        title: "Low review alert",
        description:
          "Emails owners/admins when a client leaves a review of 3 stars or less, with the full review text so you can respond quickly.",
        trigger: "Review → Submitted (rating ≤ 3)",
      },
      {
        key: "weekly_ops_digest",
        title: "Weekly operations digest",
        description:
          "Monday-morning recap of last week: revenue, jobs completed/cancelled, average rating, overdue invoices, and unassigned bookings in the week ahead.",
        trigger: "Mondays at 08:00 UTC",
      },
      {
        key: "monthly_ops_digest",
        title: "Monthly operations digest",
        description:
          "1st-of-month recap of the prior month: revenue, job counts, rating, top clients by revenue, top performer, and new clients added.",
        trigger: "1st of each month at 09:00 UTC",
      },
      {
        key: "auto_archive_old_records",
        title: "Auto-archive old records",
        description:
          "Archives finished bookings, invoices, and estimates older than the age set below (2 years unless you change it) so the default list views stay fast. Archived rows are hidden but not deleted.",
        trigger: "Daily at 04:30 UTC",
      },
      {
        key: "feed_visible",
        title: "Show team feed",
        description:
          "When on, the Feed tab appears in both the admin and field apps with a shared activity stream. When off, the feed routes 404 and nav links are hidden.",
        trigger: "Feed feature toggle",
      },
      {
        key: "product_changelog_email",
        title: "Sollos product updates",
        description:
          "Emails you a short summary of what's new in Sollos when we ship meaningful changes. At most weekly; nothing on a quiet week. Each owner can unsubscribe from their own copy.",
        trigger: "Weekly, only when there's something to report",
      },
    ],
  },
];

/**
 * The two permanent flows, derived from the one STAGES source so the split
 * can never drift from the engine's own client/internal classification.
 * Client flow = every automation that messages a client; internal flow =
 * team alerts + background bookkeeping ("make my org run autonomously").
 */
export const CLIENT_STAGES: Stage[] = STAGES.map((s) => ({
  ...s,
  automations: s.automations.filter((a) =>
    CLIENT_FACING_AUTOMATION_KEYS.has(a.key),
  ),
})).filter((s) => s.automations.length > 0);

export const INTERNAL_STAGES: Stage[] = STAGES.map((s) => ({
  ...s,
  automations: s.automations.filter(
    (a) => !CLIENT_FACING_AUTOMATION_KEYS.has(a.key),
  ),
})).filter((s) => s.automations.length > 0);

type AutomationSettings = Record<string, { enabled?: boolean } | undefined>;

/** The accordion of stages, each automation with its switch — and, where an
 *  automation has a timing setting, that setting right under it. */
export function AutomationStageList({
  stages,
  settings,
  masterOn,
  thresholds,
}: {
  stages: Stage[];
  settings: AutomationSettings;
  masterOn: boolean;
  thresholds: ThresholdValues;
}) {
  const isEnabled = (key: AutomationKey) =>
    resolveAutomationEnabled(settings as Record<string, { enabled: boolean }>, key);

  return (
    <div className={`space-y-3 ${masterOn ? "" : "pointer-events-none opacity-50"}`}>
      {stages.map((stage) => {
        const Icon = stage.icon;
        const total = stage.automations.length;
        const onCount = stage.automations.filter((a) => isEnabled(a.key)).length;
        return (
          <details key={stage.id} className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{stage.label}</p>
                <p className="truncate text-xs text-muted-foreground">{stage.outcome}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  onCount === 0
                    ? "bg-muted text-muted-foreground"
                    : onCount === total
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                }`}
              >
                {onCount === 0 ? "off" : `${onCount} of ${total} on`}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>

            <div className="border-t border-border p-4">
              {stage.bundlePreset && (
                <form
                  action={applyAutomationPresetAction}
                  className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
                >
                  <p className="text-[11px] text-muted-foreground">
                    These are internal — nothing here emails or texts a client.
                  </p>
                  <input type="hidden" name="preset" value={stage.bundlePreset} />
                  <SubmitButton variant="outline" size="sm" pendingLabel="Enabling…">
                    Turn all of these on
                  </SubmitButton>
                </form>
              )}
              <ul className="space-y-3">
                {stage.automations.map((a) => {
                  const on = isEnabled(a.key);
                  const timing = THRESHOLD_FOR_AUTOMATION[a.key];
                  return (
                    <li key={a.key} className="rounded-lg border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{a.title}</span>
                            <AudienceBadge audience={automationAudience(a.key)} />
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {a.trigger}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                        </div>
                        {a.key === "review_request_after_completion" && (
                          <AutomationFrequencySelect
                            automationKey="review_request_after_completion"
                            current={reviewAskFrequency(settings as Record<string, { enabled: boolean }>)}
                            options={REVIEW_ASK_FREQUENCY_OPTIONS}
                          />
                        )}
                        {a.key === "rebooking_prompt_email" && (
                          <AutomationFrequencySelect
                            automationKey="rebooking_prompt_email"
                            current={
                              REBOOKING_FREQUENCY_OPTIONS.find(
                                (o) => o.days === rebookingGapDays(settings as Record<string, { enabled: boolean }>),
                              )?.value ?? "monthly"
                            }
                            options={REBOOKING_FREQUENCY_OPTIONS}
                          />
                        )}
                        <form action={toggleAutomationAction} className="shrink-0">
                          <input type="hidden" name="key" value={a.key} />
                          <input type="hidden" name="enabled" value={on ? "false" : "true"} />
                          <SubmitButton
                            variant={on ? "default" : "outline"}
                            size="sm"
                            pendingLabel={on ? "Disabling…" : "Enabling…"}
                          >
                            {on ? "Enabled" : "Disabled"}
                          </SubmitButton>
                        </form>
                      </div>
                      {timing && on && (
                        <ThresholdInline spec={timing} value={thresholds[timing.field]} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/**
 * The one master switch, shown at the top of both automation pages. It was
 * the first thing on the single Automations page; splitting the page must not
 * hide it from either half, since it governs both.
 */
export function MasterSwitchBanner({
  masterOn,
  enabledCount,
}: {
  masterOn: boolean;
  enabledCount: number;
}) {
  return (
    <div
      className={`mb-4 rounded-lg border p-4 ${
        masterOn ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/10"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Zap className={`mt-0.5 h-4 w-4 shrink-0 ${masterOn ? "text-emerald-600" : "text-amber-600"}`} />
          <div>
            <p className="text-sm font-medium">
              {masterOn ? "Automations are on" : "Automations are off"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {masterOn
                ? `${enabledCount} automation${enabledCount === 1 ? "" : "s"} running across Sollos. Nothing else fires unless you turn it on.`
                : "Nothing runs at all — no emails, texts, invoices, or reminders. This one switch covers client messages, team alerts, and the switches on Invoicing and Payroll."}
            </p>
          </div>
        </div>
        <form action={toggleAutomationsMasterAction}>
          <input type="hidden" name="enabled" value={masterOn ? "false" : "true"} />
          <button
            type="submit"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {masterOn ? "Turn all off" : "Turn automations on"}
          </button>
        </form>
      </div>
    </div>
  );
}

/** "Also on…" — where the rest of the switches live, so neither page reads
 *  as the whole story. */
export function OtherAutomationPages({ current }: { current: "client" | "team" }) {
  const links = [
    current === "team"
      ? { href: "/app/settings/automations", label: "Client messages" }
      : { href: "/app/settings/team-alerts", label: "Team alerts & housekeeping" },
    { href: "/app/settings/invoicing", label: "Invoicing" },
    { href: "/app/settings/recurring-invoices", label: "Recurring invoices" },
    { href: "/app/settings/payroll", label: "Payroll & timesheets" },
    { href: "/app/settings/intake-forms", label: "Website & lead forms" },
  ];
  return (
    <p className="mb-6 text-xs text-muted-foreground">
      More automations live beside what they act on:{" "}
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && " · "}
          <Link href={l.href} className="underline underline-offset-2 hover:text-foreground">
            {l.label}
          </Link>
        </span>
      ))}
      .
    </p>
  );
}
