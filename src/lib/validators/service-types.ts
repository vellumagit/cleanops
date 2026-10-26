import { z } from "zod";
import { optionalTextUpTo, dollarStringToCents } from "./common";
import { ServiceTypeEnum } from "./bookings";

/**
 * Validates service_type rows submitted from the settings UI.
 *
 * `category` is restricted to the existing service_type enum because
 * downstream tables (bookings.service_type, contracts.service_type)
 * still hold an enum value alongside the FK — every custom service
 * has to bucket into one of the built-in categories.
 *
 * Default duration / price are pre-fill values for the booking form;
 * both optional. Empty strings come through as undefined.
 */
/** Shared with the form's maxLength so the two can't disagree. */
export const SERVICE_DESCRIPTION_MAX = 10000;

export const ServiceTypeRowSchema = z.object({
  category: ServiceTypeEnum,
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(64, "Keep names under 64 characters"),
  // 10,000 (was 280, then 2,000): Svitlana writes out what a service
  // includes, and her deep-clean list alone is ~4,000. The column is
  // unbounded text; this is the only cap. The tickable version of the same
  // list belongs in a checklist, which has sections.
  // optionalTextUpTo, not optionalText: the shared one caps at 2,000 first,
  // and that cap is what Svitlana kept hitting after this said 10,000.
  description: optionalTextUpTo(SERVICE_DESCRIPTION_MAX),
  default_duration_minutes: z
    .string()
    .transform((s) => (s === "" ? null : Number(s)))
    .refine(
      (n) => n === null || (Number.isFinite(n) && n > 0),
      "Duration must be a positive number of minutes",
    )
    .nullable()
    .optional(),
  default_price_cents: z
    .string()
    .transform((s) => (s === "" ? null : s))
    .pipe(
      z.union([
        z.null(),
        dollarStringToCents,
      ]),
    )
    .optional(),
  color: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .refine(
      (s) => s === null || /^#[0-9a-fA-F]{6}$/.test(s),
      "Color must be a hex code like #00aaff",
    )
    .nullable()
    .optional(),
  sort_order: z
    .string()
    .transform((s) => (s === "" ? 100 : Number(s)))
    .refine(
      (n) => Number.isFinite(n) && n >= 0 && n <= 9999,
      "Sort order must be between 0 and 9999",
    ),
  is_active: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .transform((v) => v === "on" || v === "true"),
});

export type ServiceTypeRowInput = z.infer<typeof ServiceTypeRowSchema>;
