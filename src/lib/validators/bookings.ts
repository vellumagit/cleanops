import { z } from "zod";
import {
  dollarStringToCents,
  localInputToUtcIso,
  optionalDollarStringToCents,
  optionalText,
} from "./common";

export const ServiceTypeEnum = z.enum([
  "standard",
  "deep",
  "move_out",
  "recurring",
]);

export const BookingStatusEnum = z.enum([
  "pending",
  "confirmed",
  "en_route",
  "in_progress",
  "completed",
  "cancelled",
]);

export const RecurrencePatternEnum = z.enum([
  "weekly",
  "bi_weekly",
  "tri_weekly",
  "monthly",
  "custom_weekly",
  "monthly_nth",
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
      (n) => Number.isFinite(n) && n > 0 && n <= 24 * 60,
      "Duration must be between 1 and 1440 minutes",
    ),
  service_type: ServiceTypeEnum,
  status: BookingStatusEnum,
  total_cents: dollarStringToCents,
  hourly_rate_cents: optionalDollarStringToCents,
  address: optionalText,
  notes: optionalText,
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
      (n) => Number.isFinite(n) && n > 0 && n <= 24 * 60,
      "Duration must be between 1 and 1440 minutes",
    ),
  service_type: ServiceTypeEnum,
  total_cents: dollarStringToCents,
  hourly_rate_cents: optionalDollarStringToCents,
  address: optionalText,
  notes: optionalText,
});

export type RecurringBookingInput = z.infer<typeof RecurringBookingSchema>;
