import { z } from "zod";
import { dollarStringToCents, optionalText } from "./common";

export const ContractStatusEnum = z.enum(["active", "ended", "cancelled"]);
export const ServiceTypeEnum = z.enum([
  "standard",
  "deep",
  "move_out",
  "recurring",
]);

const dateString = z
  .string()
  .min(1, "Required")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

const optionalDateString = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? null : s))
  .refine(
    (s) => s === null || !Number.isNaN(Date.parse(s)),
    "Invalid date",
  );

export const ContractSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  estimate_id: z
    .string()
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? null : s))
    .refine(
      (s) =>
        s === null ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          s,
        ),
      "Invalid estimate id",
    ),
  service_type: ServiceTypeEnum,
  start_date: dateString,
  end_date: optionalDateString,
  agreed_price_cents: dollarStringToCents,
  payment_terms: optionalText,
  status: ContractStatusEnum,
});

export type ContractInput = z.infer<typeof ContractSchema>;
