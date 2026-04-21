import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { toggleAutomationAction, type AutomationKey } from "./actions";

export const metadata = { title: "Automations" };

type AutomationDef = {
  key: AutomationKey;
  title: string;
  description: string;
  trigger: string;
};

const AUTOMATIONS: AutomationDef[] = [
  {
    key: "auto_invoice_on_job_complete",
    title: "Auto-draft invoice on job complete",
    description:
      "Creates a draft invoice for the client automatically when a booking is marked completed. You still need to review and send it.",
    trigger: "Booking → Completed",
  },
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
    key: "booking_reminder_client_email",
    title: "24-hour booking reminder to client",
    description:
      "Emails the client roughly 24 hours before their booking with a heads-up about the service, time, and address. Sent at most once per booking.",
    trigger: "Daily cron, ~18:00 UTC",
  },
  {
    key: "estimate_sent_email",
    title: "Send estimate to client",
    description:
      "Controls the 'Send to client' button on estimates. When off, clicking Send returns an error instead of emailing.",
    trigger: "Estimate → Send clicked",
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
  {
    key: "review_submitted_notify",
    title: "Notify admin on new review",
    description:
      "Sends an in-app notification to owners and admins when a client submits a review.",
    trigger: "Review → Submitted",
  },
  {
    key: "booking_assignment_notify",
    title: "Notify employee on booking assignment",
    description:
      "Sends a push notification to the assigned employee when a booking is assigned to them.",
    trigger: "Booking → Assigned",
  },
  {
    key: "unassigned_booking_alert",
    title: "Unassigned booking alert",
    description:
      "Emails owners/admins when a booking is within 24 hours and still has no cleaner assigned. Silent on days where everything is staffed — no empty alerts.",
    trigger: "Daily scan at 22:00 UTC",
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
    // Default to enabled if no preference set
    return settings[key]?.enabled !== false;
  }

  return (
    <PageShell
      title="Automations"
      description="Control which automatic actions fire in the background."
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <p>
            Automations run silently in the background. They never block primary
            actions — if one fails, it fails quietly.
          </p>
        </div>
      </div>
      <ul className="space-y-3">
        {AUTOMATIONS.map((a) => {
          const on = isEnabled(a.key);
          return (
            <li key={a.key} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{a.title}</span>
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
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}
