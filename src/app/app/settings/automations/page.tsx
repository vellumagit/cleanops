import Link from "next/link";
import {
  ChevronLeft,
  ChevronDown,
  Zap,
  Users,
  Clock,
  Star,
  Receipt,
  FileText,
  CalendarPlus,
  Sparkles,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { SubmitButton } from "@/components/submit-button";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import {
  toggleAutomationAction,
  setOrgContactDefaultAction,
  toggleAutomationsMasterAction,
  applyAutomationPresetAction,
  type AutomationKey,
} from "./actions";

export const metadata = { title: "Automations" };

type AutomationDef = {
  key: AutomationKey;
  title: string;
  description: string;
  trigger: string;
};

type Stage = {
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
 * Automations organized by the LIFE OF A JOB, not by channel or recipient.
 * Owners think in moments — "someone books, they get confirmed, reminded the
 * day before, invoiced when it's done" — so the page tells that story in
 * order. Every automation lives in exactly one stage.
 */
const STAGES: Stage[] = [
  {
    id: "winning",
    label: "Winning the work",
    outcome: "Estimates go out, get followed up, and expire on their own.",
    icon: FileText,
    automations: [
      {
        key: "estimate_sent_email",
        title: "Send estimate to client",
        description:
          "Controls the 'Send to client' button on estimates. When off, clicking Send returns an error instead of emailing.",
        trigger: "Estimate → Send clicked",
      },
      {
        key: "estimate_followup_email",
        title: "Estimate follow-up",
        description:
          "7 days after sending an estimate that hasn't been approved or declined, emails the client a 'still interested?' check-in. A second 'last chance' email fires at 14 days before the estimate auto-expires at day 30.",
        trigger: "Daily scan at 09:30 UTC",
      },
      {
        key: "auto_expire_stale_estimates",
        title: "Auto-expire stale estimates",
        description:
          "Flips estimates in Sent status with no activity for 30 days to Expired, so your estimates list stays focused on live opportunities. Threshold configurable per-org.",
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
        key: "auto_complete_past_bookings",
        title: "Auto-complete past bookings",
        description:
          "Marks bookings still in Pending or Confirmed status as Completed once their scheduled time is more than 24 hours in the past. Prevents ghost jobs cluttering the list.",
        trigger: "Daily at 02:00 UTC",
      },
      {
        key: "auto_invoice_on_job_complete",
        title: "Auto-draft invoice on job complete",
        description:
          "Creates a draft invoice for the client automatically when a booking is marked completed. You still need to review and send it.",
        trigger: "Booking → Completed",
      },
      {
        key: "auto_recurring_invoices",
        title: "Auto-generate recurring invoices",
        description:
          "Generates invoices on a schedule for contract clients. Set up via Settings → Recurring Invoices. Supports weekly, biweekly, monthly, and quarterly cadences.",
        trigger: "Daily at 06:30 UTC",
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
      {
        key: "auto_void_overdue_invoices",
        title: "Auto-void long-overdue invoices",
        description:
          "Flips invoices to Void after 90 days past due with no payment activity. Stops the overdue reminder cron from continuing to email the client. Threshold configurable per-org.",
        trigger: "Daily at 03:30 UTC",
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
        title: "Internal review request — within 24h of every job",
        description:
          "Emails the client a Sollos-hosted review link within 24 hours of each completed booking. Captures a 1-5 star rating + comment scoped to the employee who did the work. Powers the dashboard rating, per-employee scores, and bonus rules.",
        trigger: "Daily cron, ~10:00 UTC — fires once per booking",
      },
      {
        key: "gbp_review_request",
        title: "Google review request — 24h after first job, then monthly",
        description:
          "Emails the client a Google review link 24 hours after their FIRST completed booking, then monthly reminders if they haven't clicked. Stops when the client clicks or hits the reminder cap. Requires your Google Review URL in Settings → Branding.",
        trigger: "Daily cron, ~11:00 UTC",
      },
      {
        key: "rebooking_prompt_email",
        title: "Rebooking prompt",
        description:
          "14+ days after a completed job, if the client has no future booking on the calendar, emails them a friendly 'ready for your next clean?' nudge. At most once every 30 days per client.",
        trigger: "Daily scan at 15:00 UTC",
      },
    ],
  },
  {
    id: "office",
    label: "Team & back office",
    outcome:
      "Crew schedules, owner digests, and housekeeping. None of these touch your clients — safe to turn on as a bundle.",
    icon: Users,
    bundlePreset: "team_office",
    automations: [
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
        key: "overtime_warning",
        title: "Overtime warning",
        description:
          "Friday email to any employee whose week-to-date hours are within 20% of your overtime threshold (default 40h, configurable).",
        trigger: "Fridays at 15:00 UTC",
      },
      {
        key: "pto_status_notify",
        title: "PTO request decision email",
        description:
          "Emails the employee when their time-off request is approved, declined, or cancelled.",
        trigger: "PTO → Approved / Declined / Cancelled",
      },
      {
        key: "payroll_paid_receipt",
        title: "Payroll paid receipt",
        description:
          "Emails each employee a receipt when a payroll run is marked paid, showing amount, hours, regular/bonus/PTO breakdown.",
        trigger: "Payroll Run → Marked Paid",
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
        key: "stripe_payout_alert",
        title: "Stripe payout notification",
        description:
          "Emails owners when Stripe sends a payout to your bank account, with the amount and expected arrival date.",
        trigger: "Stripe → payout.paid webhook",
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
          "Archives bookings, invoices, and estimates older than 2 years so the default list views stay fast. Archived rows are hidden but not deleted.",
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
        key: "system_feed_events",
        title: "Auto-post system events to feed",
        description:
          "Automatically posts activity to the team feed when bookings are created, updated, or completed. Only matters when the feed itself is visible.",
        trigger: "Booking events",
      },
      {
        key: "divide_crew_hours",
        title: "Divide team-job hours across the crew",
        description:
          "When two or more cleaners work a job together, show each of them their share of the hours (job length ÷ crew) in the field app. Does not change the visit window, pay, or the client's bill.",
        trigger: "Applies to any job with 2+ crew",
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

/** The three starting bundles shown at the top. Key sets live in actions.ts. */
const PRESET_CARDS = [
  {
    preset: "essentials",
    label: "The essentials",
    blurb:
      "Confirm bookings, remind the day before, draft + chase invoices, receipt on payment. 8 automations.",
    recommended: true,
  },
  {
    preset: "full_service",
    label: "Full service",
    blurb:
      "Essentials plus reviews, rebooking nudges, estimate follow-ups, crew schedules, and digests. 19 automations.",
    recommended: false,
  },
  {
    preset: "custom",
    label: "I'll pick myself",
    blurb: "Turns automations on but enables nothing — browse below and choose.",
    recommended: false,
  },
];

export default async function AutomationsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data: org } = (await admin
    .from("organizations")
    .select("automation_settings, default_contact_preference, automations_enabled")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      automation_settings: Record<string, { enabled: boolean }>;
      default_contact_preference: string | null;
      automations_enabled: boolean | null;
    } | null;
  };

  const settings = org?.automation_settings ?? {};
  const contactDefault = org?.default_contact_preference ?? "email";
  const masterOn = org?.automations_enabled === true;
  const enabledCount = Object.values(settings).filter(
    (v) => (v as { enabled?: boolean })?.enabled === true,
  ).length;

  function isEnabled(key: AutomationKey): boolean {
    return resolveAutomationEnabled(settings, key);
  }

  return (
    <PageShell
      title="Automations"
      description="What Sollos does for you automatically, at every stage of a job."
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
      {/* MASTER SWITCH */}
      <div
        className={`mb-4 rounded-lg border p-4 ${
          masterOn
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-amber-500/50 bg-amber-500/10"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Zap
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                masterOn ? "text-emerald-600" : "text-amber-600"
              }`}
            />
            <div>
              <p className="text-sm font-medium">
                {masterOn ? "Automations are on" : "Automations are off"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {masterOn
                  ? `${enabledCount} automation${enabledCount === 1 ? "" : "s"} running. Nothing else fires unless you turn it on below.`
                  : "Nothing runs at all — no emails, texts, invoices, or reminders. Start from a preset below, or turn this on and pick one by one."}
              </p>
            </div>
          </div>
          <form action={toggleAutomationsMasterAction}>
            <input
              type="hidden"
              name="enabled"
              value={masterOn ? "false" : "true"}
            />
            <button
              type="submit"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {masterOn ? "Turn all off" : "Turn automations on"}
            </button>
          </form>
        </div>
      </div>

      {/* HOW IT WORKS — the decision chain, permanently visible. */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-[11px] text-muted-foreground">
        <span className="mr-1">How a client message decides to send:</span>
        <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
          1 · Automation on below
        </span>
        <span aria-hidden>→</span>
        <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
          2 · That client&apos;s own setting
        </span>
        <span aria-hidden>→</span>
        <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
          3 · Texts need the client&apos;s opt-in
        </span>
        <span className="basis-full text-[11px]">
          Org-wide rules live here. Fine-tune any individual person on{" "}
          <Link href="/app/clients" className="underline underline-offset-2">
            their client page
          </Link>
          . Staff and back-office automations skip steps 2–3 — they never touch
          clients.
        </span>
      </div>

      {/* PRESETS — the first decision is one click, not thirty-nine. */}
      <div className="mb-6">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Start from a preset — fine-tune anything after. Presets only turn
          things on; they never switch off something you enabled.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESET_CARDS.map((p) => (
            <form
              key={p.preset}
              action={applyAutomationPresetAction}
              className={`relative flex flex-col rounded-xl border bg-card p-4 ${
                p.recommended ? "border-emerald-500/50" : "border-border"
              }`}
            >
              {p.recommended && (
                <span className="absolute -top-2 left-3 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <Sparkles className="h-3 w-3" /> Recommended
                </span>
              )}
              <input type="hidden" name="preset" value={p.preset} />
              <p className="text-sm font-medium">{p.label}</p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">
                {p.blurb}
              </p>
              <SubmitButton
                variant={p.recommended ? "default" : "outline"}
                size="sm"
                pendingLabel="Applying…"
                className="mt-3"
              >
                {p.preset === "custom" ? "Start empty" : `Use ${p.label.toLowerCase()}`}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>

      {/* HOUSE DEFAULT for client messages */}
      <div className="mb-8 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium">Default client notifications</p>
        <p className="mt-1 text-xs text-muted-foreground">
          What a client gets unless their own setting says otherwise. Change it
          per client on the client&apos;s page.
        </p>
        <form
          action={setOrgContactDefaultAction}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          {[
            { value: "email", label: "Email only" },
            { value: "sms", label: "Text only" },
            { value: "both", label: "Email + text" },
            { value: "none", label: "No notifications" },
          ].map((opt) => {
            const active = contactDefault === opt.value;
            return (
              <button
                key={opt.value}
                type="submit"
                name="default_contact_preference"
                value={opt.value}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-foreground bg-muted font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </form>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Texts only reach clients who have opted in to SMS, regardless of this
          setting.
        </p>
      </div>

      {/* THE JOURNEY — every automation, in the order a job actually happens. */}
      <div
        className={`space-y-3 ${masterOn ? "" : "pointer-events-none opacity-50"}`}
      >
        {STAGES.map((stage) => {
          const Icon = stage.icon;
          const total = stage.automations.length;
          const onCount = stage.automations.filter((a) =>
            isEnabled(a.key),
          ).length;
          return (
            <details
              key={stage.id}
              className="group rounded-xl border border-border bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{stage.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {stage.outcome}
                  </p>
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
                      These are internal — nothing here emails or texts a
                      client. (Auto-void stays a separate decision; it changes
                      invoices.)
                    </p>
                    <input
                      type="hidden"
                      name="preset"
                      value={stage.bundlePreset}
                    />
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      pendingLabel="Enabling…"
                    >
                      Turn all of these on
                    </SubmitButton>
                  </form>
                )}
                <ul className="space-y-3">
                  {stage.automations.map((a) => {
                    const on = isEnabled(a.key);
                    return (
                      <li
                        key={a.key}
                        className="rounded-lg border border-border bg-background p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">
                                {a.title}
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
                            <input type="hidden" name="key" value={a.key} />
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
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          );
        })}
      </div>
    </PageShell>
  );
}
