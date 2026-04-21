import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * StatusBadge — consistent color-coded pill for status indicators across
 * the ops console.
 *
 * Color meanings:
 *   green  — done, paid, confirmed, active, completed
 *   blue   — in progress, sent, scheduled
 *   amber  — pending, needs attention, below threshold, draft
 *   red    — overdue, cancelled, urgent, failed
 *   neutral — generic / default
 */

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        green:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
        blue: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300",
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
    case "completed":
      return "green";
    case "confirmed":
    case "en_route":
    case "in_progress":
      return "blue";
    case "pending":
      return "amber";
    case "cancelled":
      return "red";
  }
}

export function invoiceStatusTone(
  status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void",
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
