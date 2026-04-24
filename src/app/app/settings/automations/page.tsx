import Link from "next/link";
import {
  ChevronLeft,
  Zap,
  Mail,
  Users,
  Bell,
  PlayCircle,
  Archive,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { SubmitButton } from "@/components/submit-button";
import {
  resolveAutomationEnabled,
  isDefaultOff,
} from "@/lib/automation-defaults";
import { toggleAutomationAction, type AutomationKey } from "./actions";

export const metadata = { title: "Automations" };

type AutomationDef = {
  key: AutomationKey;
  title: string;
  description: string;
  trigger: string;
};

type Category = {
  id: string;
  label: string;
  /** One-line explanation shown under the category header. Helps the
   *  owner know what falls under each bucket without reading each item. */
  description: string;
  icon: typeof Zap;
  automations: AutomationDef[];
};

/**
 * Automations grouped by who the recipient is / what the automation
 * does, so the Automations page is scannable instead of a flat wall
 * of 29 toggles. Adding a new automation: put it in the category that
 * matches its RECIPIENT (client, employee, owner) or its EFFECT
 * (auto-draft something, state-transition housekeeping).
 */
const CATEGORIES: Category[] = [
  {
    id: "client",
    label: "Client emails",
    description:
      "Outbound mail to the people who hire you. Opt-in carefully — clients notice.",
    icon: Mail,
    automations: [
      {
        key: "booking_confirmation_email",
        title: "Booking confirmation email",
        description:
          "Sends the client an email when a new booking is created or confirmed for them.",
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
        key: "booking_cancelled_email",
        title: "Booking cancelled email",
        description:
          "Emails the client when a booking's status flips to cancelled. Also pushes the assigned employee so they don't show up — both are separate automations.",
        trigger: "Booking → Cancelled",
      },
      {
        key: "booking_reminder_client_email",
        title: "24-hour booking reminder to client",
        description:
          "Emails the client roughly 24 hours before their booking with a heads-up about the service, time, and address. Sent at most once per booking.",
        trigger: "Daily cron, ~18:00 UTC",
      },
      {
        key: "rebooking_prompt_email",
        title: "Rebooking prompt",
        description:
          "14+ days after a completed job, if the client has no future booking on the calendar, emails them a friendly 'ready for your next clean?' nudge. Sent at most once every 30 days per client.",
        trigger: "Daily scan at 15:00 UTC",
      },
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
        key: "invoice_paid_receipt",
        title: "Receipt + review request on payment",
        description:
          "Sends the client a payment receipt and a link to leave a review after their invoice is marked paid.",
        trigger: "Invoice → Paid",
      },
      {
        key: "invoice_overdue_reminder",
        title: "Overdue invoice reminder",
        description:
          "Sends the client a polite reminder once every 7 days while an invoice is past due. Stops automatically once the invoice is marked paid.",
        trigger: "Invoice → Overdue (daily cron)",
      },
    ],
  },
  {
    id: "team",
    label: "Team notifications",
    description:
      "Pushes + emails sent to cleaners and crew about their own work.",
    icon: Users,
    automations: [
      {
        key: "booking_assignment_notify",
        title: "Notify employee on booking assignment",
        description:
          "Sends a push notification to the assigned employee when a booking is assigned to them.",
        trigger: "Booking → Assigned",
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
          "Emails the employee when their time-off request is approved, declined, or cancelled. Previously only shown in-app.",
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
    ],
  },
  {
    id: "alerts",
    label: "Owner alerts & digests",
    description:
      "What you (the owner/admin) get pinged about. Turn off the noisy ones.",
    icon: Bell,
    automations: [
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
        key: "unassigned_booking_alert",
        title: "Unassigned booking alert",
        description:
          "Emails owners/admins when a booking is within 24 hours and still has no cleaner assigned. Silent on days where everything is staffed — no empty alerts.",
        trigger: "Daily scan at 22:00 UTC",
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
    ],
  },
  {
    id: "auto-create",
    label: "Auto-create",
    description:
      "Creates new records automatically when a trigger fires.",
    icon: PlayCircle,
    automations: [
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
    ],
  },
  {
    id: "housekeeping",
    label: "Housekeeping",
    description:
      "Cleans up state automatically so your lists stay focused on what matters.",
    icon: Archive,
    automations: [
      {
        key: "auto_complete_past_bookings",
        title: "Auto-complete past bookings",
        description:
          "Marks bookings still in Pending or Confirmed status as Completed once their scheduled time is more than 24 hours in the past. Prevents ghost jobs cluttering the list.",
        trigger: "Daily at 02:00 UTC",
      },
      {
        key: "auto_expire_stale_estimates",
        title: "Auto-expire stale estimates",
        description:
          "Flips estimates in Sent status with no activity for 30 days to Expired, so your estimates list stays focused on live opportunities. Threshold configurable per-org.",
        trigger: "Daily at 03:00 UTC",
      },
      {
        key: "auto_void_overdue_invoices",
        title: "Auto-void long-overdue invoices",
        description:
          "Flips invoices to Void after 90 days past due with no payment activity. Stops the overdue reminder cron from continuing to email the client. Threshold configurable per-org.",
        trigger: "Daily at 03:30 UTC",
      },
      {
        key: "auto_archive_old_records",
        title: "Auto-archive old records",
        description:
          "Archives bookings, invoices, and estimates older than 2 years so the default list views stay fast. Archived rows are hidden but not deleted. Threshold configurable per-org.",
        trigger: "Daily at 04:30 UTC",
      },
    ],
  },
];

export default async function AutomationsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data: org } = (await admin
    .from("organizations")
    .select("automation_settings")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { automation_settings: Record<string, { enabled: boolean }> } | null;
  };

  const settings = org?.automation_settings ?? {};

  function isEnabled(key: AutomationKey): boolean {
    // Shared resolver — explicit setting wins, otherwise the per-key
    // default from lib/automation-defaults.ts (most on, some off).
    return resolveAutomationEnabled(settings, key);
  }

  function isExplicitlySet(key: AutomationKey): boolean {
    return settings[key]?.enabled !== undefined;
  }

  return (
    <PageShell
      title="Automations"
      description="Control which automatic actions fire in the background."
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
      <div className="mb-6 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <p>
            Automations run silently in the background. They never block primary
            actions — if one fails, it fails quietly.
          </p>
        </div>
      </div>

      <div className="space-y-10">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          return (
            <section key={category.id}>
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{category.label}</h2>
                  <p className="text-xs text-muted-foreground">
                    {category.description}
                  </p>
                </div>
              </div>
              <ul className="space-y-3">
                {category.automations.map((a) => {
                  const on = isEnabled(a.key);
                  const defaultOff = isDefaultOff(a.key);
                  const showOptInHint = defaultOff && !isExplicitlySet(a.key);
                  return (
                    <li
                      key={a.key}
                      className="rounded-lg border border-border bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {a.title}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {a.trigger}
                            </span>
                            {defaultOff && (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                Off by default
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {a.description}
                          </p>
                          {showOptInHint && (
                            <p className="mt-1.5 text-[11px] italic text-amber-700 dark:text-amber-400">
                              This touches your clients directly — it stays off
                              until you explicitly turn it on.
                            </p>
                          )}
                        </div>
                        <form
                          action={toggleAutomationAction}
                          className="shrink-0"
                        >
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
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}
