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

export const InvoiceSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  booking_id: optionalUuid,
  status: InvoiceStatusEnum,
  amount_cents: dollarStringToCents,
  due_date: optionalDateString,
});

export type InvoiceInput = z.infer<typeof InvoiceSchema>;
