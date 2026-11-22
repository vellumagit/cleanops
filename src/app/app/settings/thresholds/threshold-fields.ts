import type { AutomationKey } from "@/app/app/settings/automations/actions";

/**
 * The five timing settings, each tied to the automation it times. They used
 * to share a page of their own ("Automation thresholds", filed under Team);
 * now each renders beside its switch (see ThresholdInline), and this table is
 * what pairs them up.
 *
 * `nullable`: blank saves as null, which the crons read as "never" — the
 * double-off the old page offered. Overtime has no off: the warning needs a
 * number.
 */
export const THRESHOLD_FIELDS = {
  stale_estimate_expire_days: { min: 1, nullable: true },
  invoice_void_days: { min: 30, nullable: true },
  booking_auto_complete_hours: { min: 1, nullable: true },
  archive_after_days: { min: 180, nullable: true },
  overtime_threshold_hours: { min: 1, nullable: false },
} as const;

export type ThresholdField = keyof typeof THRESHOLD_FIELDS;

export type ThresholdSpec = {
  field: ThresholdField;
  label: string;
  suffix: string;
  hint: string;
};

/** Which automation each timing setting belongs beside. */
export const THRESHOLD_FOR_AUTOMATION: Partial<Record<AutomationKey, ThresholdSpec>> = {
  auto_expire_stale_estimates: {
    field: "stale_estimate_expire_days",
    label: "Expire after",
    suffix: "days with no answer",
    hint: "Default 30. Blank means estimates never expire on their own.",
  },
  auto_void_overdue_invoices: {
    field: "invoice_void_days",
    label: "Void when",
    suffix: "days past due",
    hint: "Default 365 (a year). At least 30. Blank means never.",
  },
  auto_complete_past_bookings: {
    field: "booking_auto_complete_hours",
    label: "Mark completed",
    suffix: "hours after the scheduled time",
    hint: "Default 24. Blank means jobs are never completed for you.",
  },
  auto_archive_old_records: {
    field: "archive_after_days",
    label: "Archive after",
    suffix: "days",
    hint: "Default 730 (two years). At least 180. Blank means never.",
  },
  overtime_warning: {
    field: "overtime_threshold_hours",
    label: "Overtime starts at",
    suffix: "hours a week",
    hint: "The warning goes to anyone within 20% of this. Default 40.",
  },
};

export const THRESHOLD_SELECT = Object.keys(THRESHOLD_FIELDS).join(", ");

export type ThresholdValues = Record<ThresholdField, number | null>;

/** What a page shows if the organization row couldn't be read. */
export const EMPTY_THRESHOLDS: ThresholdValues = {
  stale_estimate_expire_days: null,
  invoice_void_days: null,
  booking_auto_complete_hours: null,
  archive_after_days: null,
  overtime_threshold_hours: 40,
};
