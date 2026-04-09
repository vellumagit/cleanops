import { z } from "zod";
import {
  dollarStringToCents,
  optionalText,
} from "./common";

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
  reference: optionalText,
  // <input type="date">  → ISO date string. Stored as timestamptz so we
  // append midnight UTC during the action.
  received_at: z
    .string()
    .min(1, "Pick a date")
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date"),
  notes: optionalText,
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
