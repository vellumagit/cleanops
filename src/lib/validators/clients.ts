import { z } from "zod";
import { optionalText, requiredText } from "./common";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

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

// Empty string → null; otherwise must look like a uuid. Used for the
// referred_by_client_id dropdown.
const optionalClientId = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s))
  .refine(
    (s) =>
      s === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    "Invalid client id",
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
  /**
   * Business to invoice under, for clients who run one. Optional and blank
   * for almost everyone. When set, money documents bill the company and name
   * this person as the contact; nothing else in the app changes.
   */
  company_name: optionalText,
  email: optionalText.refine(
    (s) => !s || /\S+@\S+\.\S+/.test(s),
    "Enter a valid email",
  ),
  phone: optionalText,
  address: optionalText,
  // PCI guard: free-text notes can't carry a card number. Last-four
  // references pass through; full PANs get rejected pre-save.
  notes: optionalText.refine(noCardNumber, {
    message: CARD_DETECTED_MESSAGE,
  }),
  // "What do they want" — the lead's story, captured by quick-add and the
  // website intake, editable here so it doesn't fossilize. Same PCI guard.
  lead_note: optionalText.refine(noCardNumber, {
    message: CARD_DETECTED_MESSAGE,
  }),
  /**
   * Superseded by contact_preference below (it was never read by any send
   * path). Optional now so the form can stop submitting it; the column is
   * still written with a default until it's dropped.
   */
  preferred_contact: PreferredContactEnum.optional().default("email"),
  /** inherit | custom | do_not_contact — see lib/notification-preferences.ts */
  contact_preference: z
    .enum(["inherit", "custom", "do_not_contact"])
    .optional()
    .default("inherit"),
  /**
   * JSON from the notification control: { booking|billing|growth :
   * off|email|sms|both|inherit }. Parsed + whitelisted here so a hand-crafted
   * POST can't write arbitrary JSON into the column.
   */
  contact_overrides: z
    .string()
    .optional()
    .transform((s) => {
      if (!s || !s.trim()) return {};
      let raw: unknown;
      try {
        raw = JSON.parse(s);
      } catch {
        return {};
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      const categories = ["booking", "billing", "growth"] as const;
      const channels = ["off", "email", "sms", "both", "inherit"];
      const events = [
        "confirmation", "reminder", "rescheduled", "cancelled",
        "invoice_send", "overdue_reminder", "payment_receipt",
        "review_request", "gbp_review_request", "rebooking_prompt",
        "estimate_followup",
      ];
      const out: Record<string, unknown> = {};
      for (const cat of categories) {
        const v = (raw as Record<string, unknown>)[cat];
        if (typeof v === "string" && channels.includes(v)) out[cat] = v;
      }
      // Advanced per-message mutes + the disclosure flag — whitelisted so a
      // crafted POST can't smuggle arbitrary JSON into the column.
      const rawMuted = (raw as Record<string, unknown>).muted_events;
      if (Array.isArray(rawMuted)) {
        const muted = rawMuted.filter(
          (e): e is string => typeof e === "string" && events.includes(e),
        );
        if (muted.length > 0) out.muted_events = muted;
      }
      if ((raw as Record<string, unknown>).advanced === true) {
        out.advanced = true;
      }
      return out;
    }),
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
  /** Monthly cadence only: day of month (1-28) the cycle turns over.
   *  Capped at 28 so February needs no clamping rule. Blank = the 1st. */
  billing_anchor_day: z.preprocess(
    (v) => {
      const s = String(v ?? "").trim();
      return s === "" ? null : Number(s);
    },
    z
      .number()
      .int("Billing day must be a whole number")
      .min(1, "Billing day must be between 1 and 28")
      .max(28, "Billing day must be between 1 and 28")
      .nullable(),
  ),
  /** Biweekly cadence only: exact 14-day cycles from this date.
   *  Blank = legacy 1st & 15th. */
  billing_anchor_date: z.preprocess(
    (v) => {
      const s = String(v ?? "").trim();
      return s === "" ? null : s;
    },
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
      .nullable(),
  ),
  /** Client id of the person who referred this client. Blank → null. */
  referred_by_client_id: optionalClientId,
});

export type ClientInput = z.infer<typeof ClientSchema>;
