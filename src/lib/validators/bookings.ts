import { z } from "zod";
import {
  dollarStringToCents,
  localInputToUtcIso,
  optionalDollarStringToCents,
  optionalText,
} from "./common";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

/**
 * Card-data-aware version of optionalText used on every free-text booking
 * field. Last-four references ("paid via Visa **** 1234") pass through;
 * full PANs get rejected before they hit the database.
 */
const cardSafeOptionalText = optionalText.refine(noCardNumber, {
  message: CARD_DETECTED_MESSAGE,
});

export const ServiceTypeEnum = z.enum([
  "standard",
  "deep",
  "move_out",
  "recurring",
  "meeting",
  "consultation",
  "walkthrough",
  "other",
]);

export const BookingStatusEnum = z.enum([
  "pending",
  "confirmed",
  "en_route",
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * Validates a single split-shift segment from the booking form.
 *
 * Required invariants:
 *   - assigned_to is a non-empty UUID (no blank segments)
 *   - duration_minutes is a positive integer (no upper bound — long
 *     multi-day jobs like post-construction or move-outs may have
 *     individual segments that exceed 24h; the per-booking duration
 *     is also uncapped for the same reason. See 2026-06-02 chat.)
 *
 * Optional fields (id, hourly_rate_cents) are preserved as-is into the
 * bookings.splits JSONB but not strictly enforced here.
 */
export const SplitSegmentSchema = z.object({
  id: z.string().optional(),
  assigned_to: z
    .string()
    .uuid("Each segment must have a cleaner assigned"),
  duration_minutes: z
    .number()
    .int()
    .positive("Segment duration must be greater than zero"),
  hourly_rate_cents: z.number().int().nonnegative().optional(),
});

/**
 * Validates the full splits array as submitted from the booking form.
 * Empty array = no split shift (single-assignee booking). Non-empty
 * means split mode is enabled and every entry must be valid.
 */
export const SplitsArraySchema = z
  .array(SplitSegmentSchema)
  .refine(
    (arr) => arr.length === 0 || arr.length >= 2,
    "A split shift needs at least 2 segments",
  );

export const RecurrencePatternEnum = z.enum([
  "weekly",
  "bi_weekly",
  "tri_weekly",
  "quad_weekly",
  "monthly",
  "custom_weekly",
  "monthly_nth",
  "every_2_months",
  "every_3_months",
  "every_6_months",
]);

export const BookingSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  package_id: z
    .string()
    .transform((s) => (s && s !== "" ? s : undefined))
    .optional(),
  assigned_to: z
    .string()
    .transform((s) => (s && s !== "" ? s : undefined))
    .optional(),
  scheduled_at: z
    .string()
    .min(1, "Pick a date and time")
    .transform((s) => localInputToUtcIso(s))
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date"),
  duration_minutes: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isFinite(n) && n > 0,
      "Duration must be a positive number of minutes",
    ),
  service_type: ServiceTypeEnum,
  status: BookingStatusEnum,
  total_cents: dollarStringToCents,
  hourly_rate_cents: optionalDollarStringToCents,
  address: optionalText,
  notes: cardSafeOptionalText,
});

export type BookingInput = z.infer<typeof BookingSchema>;

/** Schema for creating a recurring booking series. */
export const RecurringBookingSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  package_id: z
    .string()
    .transform((s) => (s && s !== "" ? s : undefined))
    .optional(),
  assigned_to: z
    .string()
    .transform((s) => (s && s !== "" ? s : undefined))
    .optional(),
  recurrence_pattern: RecurrencePatternEnum,
  /** Comma-separated day numbers for custom_weekly, e.g. "1,4" */
  custom_days: z
    .string()
    .transform((s) => {
      if (!s || s.trim() === "") return undefined;
      return s
        .split(",")
        .map((d) => Number(d.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
    })
    .optional(),
  /** For monthly_nth: 1..4 = Nth, 5 = last */
  monthly_nth: z
    .string()
    .transform((s) => (s && s.trim() !== "" ? Number(s) : undefined))
    .optional()
    .refine(
      (n) => n === undefined || (Number.isFinite(n) && n >= 1 && n <= 5),
      "Invalid ordinal",
    ),
  /** For monthly_nth: 0=Sun .. 6=Sat */
  monthly_dow: z
    .string()
    .transform((s) => (s && s.trim() !== "" ? Number(s) : undefined))
    .optional()
    .refine(
      (n) => n === undefined || (Number.isFinite(n) && n >= 0 && n <= 6),
      "Invalid weekday",
    ),
  /** HH:MM time */
  start_time: z
    .string()
    .min(1, "Pick a time")
    .refine((s) => /^\d{2}:\d{2}$/.test(s), "Invalid time format"),
  /** YYYY-MM-DD start date */
  starts_at: z
    .string()
    .min(1, "Pick a start date")
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date"),
  /** Optional YYYY-MM-DD end date */
  ends_at: z
    .string()
    .transform((s) => (s && s.trim() !== "" ? s : undefined))
    .optional(),
  /** How many instances to generate ahead */
  generate_ahead: z
    .string()
    .optional()
    .default("8")
    .transform((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : 8;
    }),
  duration_minutes: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isFinite(n) && n > 0,
      "Duration must be a positive number of minutes",
    ),
  service_type: ServiceTypeEnum,
  total_cents: dollarStringToCents,
  hourly_rate_cents: optionalDollarStringToCents,
  address: optionalText,
  notes: cardSafeOptionalText,
});

export type RecurringBookingInput = z.infer<typeof RecurringBookingSchema>;
