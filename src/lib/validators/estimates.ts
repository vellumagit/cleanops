import { z } from "zod";
import { dollarStringToCents, optionalText } from "./common";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

export const EstimateStatusEnum = z.enum([
  "draft",
  "sent",
  "approved",
  "declined",
  // The expiry cron writes this; without it here, re-saving an expired
  // estimate forced the editor to pick some other status first.
  "expired",
]);

const cardSafeOptionalText = optionalText.refine(noCardNumber, {
  message: CARD_DETECTED_MESSAGE,
});

export const EstimateSchema = z.object({
  client_id: z.string().uuid("Pick a client"),
  service_description: cardSafeOptionalText,
  notes: cardSafeOptionalText,
  status: EstimateStatusEnum,
  total_cents: dollarStringToCents,
});

export type EstimateInput = z.infer<typeof EstimateSchema>;
