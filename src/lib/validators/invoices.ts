import { z } from "zod";
import { dollarStringToCents } from "./common";

export const InvoiceStatusEnum = z.enum(["draft", "sent", "paid", "overdue"]);

const optionalDateString = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s))
  .refine(
    (s) => s === null || !Number.isNaN(Date.parse(s)),
    "Invalid date",
  );

const optionalUuid = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s))
  .refine(
    (s) =>
      s === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    "Invalid id",
  );

/** Empty string → null coercion. Used for the optional tax fields so
 *  blank inputs cleanly mean "no tax on this invoice". */
const optionalText = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s));

/** Parse an optional tax rate like "" / "5" / "12.5" into basis points
 *  (bps). 500 = 5%. Empty → null (no tax). Rejects negative and >99.99%. */
const optionalTaxRateBps = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => {
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100);
  })
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 9999), {
    message: "Enter a rate between 0 and 99.99",
  });

export const InvoiceSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  booking_id: optionalUuid,
  status: InvoiceStatusEnum,
  /** The subtotal the user typed — pre-tax amount. The action computes
   *  tax on top of this and writes the grand total to amount_cents. */
  subtotal_cents: dollarStringToCents,
  due_date: optionalDateString,
  tax_rate_bps: optionalTaxRateBps,
  tax_label: optionalText,
});

export type InvoiceInput = z.infer<typeof InvoiceSchema>;
