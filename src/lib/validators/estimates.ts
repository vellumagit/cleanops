import { z } from "zod";
import { dollarStringToCents, optionalText } from "./common";

export const EstimateStatusEnum = z.enum([
  "draft",
  "sent",
  "approved",
  "declined",
]);

export const EstimateSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  service_description: optionalText,
  notes: optionalText,
  status: EstimateStatusEnum,
  total_cents: dollarStringToCents,
});

export type EstimateInput = z.infer<typeof EstimateSchema>;
