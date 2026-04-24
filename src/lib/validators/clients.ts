import { z } from "zod";
import { optionalText, requiredText } from "./common";

export const PreferredContactEnum = z.enum(["phone", "email", "sms"]);

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
});

export type ClientInput = z.infer<typeof ClientSchema>;
