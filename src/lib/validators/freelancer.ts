import { z } from "zod";
import { optionalText, requiredText, dollarStringToCents } from "./common";
import { normalizePhone } from "@/lib/phone";

/**
 * Validators for the Phase 11 freelancer bench.
 *
 * `phone` is stored as text but we enforce that it looks like E.164
 * (+1XXXXXXXXXX) — Twilio will reject anything else. We're deliberately
 * strict here because the whole feature is useless if the phone numbers
 * are malformed.
 */

// Through normalizePhone, like every other phone in the app. This used to put
// a bare "+" in front of whatever was typed, so a local "780 271 1971" was
// saved as +7802711971, which Twilio routes to Russia: shift-offer texts
// went nowhere. normalizePhone reads ten digits as a North American number.
const e164 = z
  .string()
  .transform((s) => normalizePhone(s))
  .refine(
    (s) => /^\+[1-9]\d{7,14}$/.test(s),
    "Phone must be a full number, e.g. 780 271 1971 or +15125550101",
  );

export const FreelancerContactSchema = z.object({
  full_name: requiredText("Name", 200),
  phone: e164,
  email: optionalText.refine(
    (s) => !s || /\S+@\S+\.\S+/.test(s),
    "Enter a valid email",
  ),
  notes: optionalText,
  active: z
    .string()
    .transform((s) => s === "true" || s === "on")
    .default(true),
});

export type FreelancerContactInput = z.infer<typeof FreelancerContactSchema>;

/**
 * "Send to bench" form values. Contacts are picked via multiple checkboxes
 * that each post as `contact_ids` → FormData.getAll('contact_ids').
 */
export const JobOfferSchema = z.object({
  booking_id: requiredText("Booking id"),
  pay_dollars: dollarStringToCents,
  notes: optionalText,
  positions_needed: z
    .string()
    .optional()
    .default("1")
    .transform((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    })
    .refine((n) => n >= 1 && n <= 50, "Positions must be between 1 and 50"),
  expires_in_minutes: z
    .string()
    .transform((s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : NaN;
    })
    .refine((n) => Number.isFinite(n), "Enter a valid expiry in minutes")
    .refine((n) => n >= 5 && n <= 1440, "Expiry must be between 5 and 1440 minutes"),
});

export type JobOfferInput = z.infer<typeof JobOfferSchema>;
