import { z } from "zod";
import {
  dollarStringToCents,
  optionalText,
} from "./common";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

/**
 * Zod schema for the manual "record payment" form on the invoice detail
 * page. Matches the `invoice_payments` table shape.
 *
 * Every field here is something the admin types by hand — this is the
 * MANUAL path for payments that land in the user's bank account via
 * Zelle, check, wire, Venmo, etc. Processor-triggered webhook payments
 * skip this schema entirely and insert directly.
 */

export const PAYMENT_METHODS = [
  "cash",
  "check",
  "bank_transfer",
  "zelle",
  "venmo",
  "cashapp",
  "card",
  "ach",
  "other",
] as const;

export const InvoicePaymentSchema = z.object({
  amount_dollars: dollarStringToCents.refine((c) => c > 0, {
    message: "Amount must be greater than zero",
  }),
  method: z.enum(PAYMENT_METHODS, {
    message: "Pick a payment method",
  }),
  // PCI guard: reject any text containing a Luhn-validated card number
  // before we persist it to invoice_payments.reference / .notes. Last-four
  // style references ("Visa ending in 4242") pass — they're <13 digits.
  reference: optionalText.refine(noCardNumber, {
    message: CARD_DETECTED_MESSAGE,
  }),
  // <input type="date">  → ISO date string. Stored as timestamptz so we
  // append midnight UTC during the action.
  received_at: z
    .string()
    .min(1, "Pick a date")
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date"),
  notes: optionalText.refine(noCardNumber, {
    message: CARD_DETECTED_MESSAGE,
  }),
});

export type InvoicePaymentInput = z.infer<typeof InvoicePaymentSchema>;

export function humanizePaymentMethod(
  method: (typeof PAYMENT_METHODS)[number],
): string {
  switch (method) {
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "bank_transfer":
      return "Bank transfer";
    case "zelle":
      return "Zelle";
    case "venmo":
      return "Venmo";
    case "cashapp":
      return "Cash App";
    case "card":
      return "Card";
    case "ach":
      return "ACH";
    case "other":
      return "Other";
  }
}
