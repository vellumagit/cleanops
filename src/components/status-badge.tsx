import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * StatusBadge — consistent color-coded pill for status indicators across
 * the ops console.
 *
 * Color meanings:
 *   green  — done, paid, active, completed
 *   blue   — scheduled, sent, locked in
 *   violet — happening right now (a job under way)
 *   amber  — pending, needs attention, below threshold, draft
 *   red    — overdue, cancelled, urgent, failed
 *   neutral — generic / default
 *
 * Colour is never the ONLY signal — every badge also spells the status out,
 * which is what keeps this readable for colour-blind users. The hues are
 * still chosen to survive the common forms: amber/violet/blue separate by
 * lightness as well as hue, so they stay distinguishable in greyscale.
 */

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        green:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
        blue: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300",
        violet:
          "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300",
        amber:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
        red: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300",
        neutral:
          "border-border bg-card text-muted-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type StatusTone = NonNullable<
  VariantProps<typeof statusBadgeVariants>["tone"]
>;

type Props = {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
};

export function StatusBadge({ tone = "neutral", children, className }: Props) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)}>
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Helpers for the specific enums we use in the domain
// -----------------------------------------------------------------------------

export function bookingStatusTone(
  status:
    | "pending"
    | "confirmed"
    | "en_route"
    | "in_progress"
    | "completed"
    | "cancelled",
): StatusTone {
  switch (status) {
    // Not confirmed by anyone yet — the one status that is a question rather
    // than a fact, so it wears the colour the rest of the app uses for
    // "needs a human".
    case "pending":
      return "amber";
    // Agreed and on the schedule.
    case "confirmed":
      return "blue";
    // Under way right now. Distinct from confirmed on purpose: those two used
    // to share one blue, which made the single most useful glance on the
    // scheduling grid — what is happening NOW versus what is merely booked —
    // impossible to make without reading every badge.
    case "in_progress":
    case "en_route":
      return "violet";
    case "completed":
      return "green";
    case "cancelled":
      return "red";
  }
}

export function invoiceStatusTone(
  status:
    | "draft"
    | "sent"
    | "partially_paid"
    | "paid"
    | "overdue"
    | "void"
    | "refunded",
): StatusTone {
  switch (status) {
    case "paid":
      return "green";
    case "partially_paid":
      return "blue";
    case "sent":
      return "blue";
    case "draft":
      return "amber";
    case "overdue":
      return "red";
    case "void":
      return "neutral";
    case "refunded":
      // Distinct from "void" so owners can see at a glance that money
      // moved (refunded) vs. simply nullified (void).
      return "red";
  }
}

export function estimateStatusTone(
  status: "draft" | "sent" | "approved" | "declined" | "expired",
): StatusTone {
  switch (status) {
    case "approved":
      return "green";
    case "sent":
      return "blue";
    case "draft":
      return "amber";
    case "declined":
      return "red";
    case "expired":
      return "neutral";
  }
}

export function contractStatusTone(
  status: "active" | "ended" | "cancelled",
): StatusTone {
  switch (status) {
    case "active":
      return "green";
    case "ended":
      return "neutral";
    case "cancelled":
      return "red";
  }
}

export function bonusStatusTone(status: "pending" | "paid"): StatusTone {
  return status === "paid" ? "green" : "amber";
}

export function formatBookingStatus(status: string): string {
  return status.replace(/_/g, " ");
}
