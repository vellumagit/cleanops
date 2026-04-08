import { z } from "zod";
import {
  dollarStringToCents,
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
    .transform((s) => new Date(s).toISOString())
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
