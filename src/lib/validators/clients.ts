import { z } from "zod";
import { optionalText, requiredText } from "./common";

export const PreferredContactEnum = z.enum(["phone", "email", "sms"]);

export const BillingCadenceEnum = z.enum(["on_demand", "biweekly", "monthly"]);
export const BillingTypeEnum = z.enum(["itemized", "flat_rate"]);

// Empty string → null; otherwise must look like a uuid. Used for the
// preferred_cleaner_id dropdown where the blank option is legitimate.
const optionalMembershipId = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s))
  .refine(
    (s) =>
      s === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    "Invalid cleaner id",
  );

// "" → null; positive integer string → number
const optionalCents = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s))
  .refine(
    (s) => s === null || (/^\d+$/.test(s) && parseInt(s, 10) >= 0),
    "Must be a non-negative whole number",
  )
  .transform((s) => (s === null ? null : parseInt(s, 10)));

export const ClientSchema = z.object({
  name: requiredText("Name", 200),
  email: optionalText.refine(
    (s) => !s || /\S+@\S+\.\S+/.test(s),
    "Enter a valid email",
  ),
  phone: optionalText,
  address: optionalText,
  notes: optionalText,
  preferred_contact: PreferredContactEnum,
  /** Membership id of the cleaner to auto-assign on new bookings for
   *  this client. Blank / omitted → no preference. */
  preferred_cleaner_id: optionalMembershipId,
  /** Invoicing frequency: on_demand (per-job), biweekly, or monthly. */
  billing_cadence: BillingCadenceEnum,
  /** Line-item strategy for biweekly/monthly clients. */
  billing_type: BillingTypeEnum,
  /** Fixed amount (in cents) per billing period. Only used when
   *  billing_type = 'flat_rate'. Leave blank for itemized clients. */
  flat_rate_cents: optionalCents,
});

export type ClientInput = z.infer<typeof ClientSchema>;
