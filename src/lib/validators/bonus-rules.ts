import { z } from "zod";
import { dollarStringToCents } from "./common";

export const BonusRuleSchema = z.object({
  enabled: z
    .string()
    .optional()
    .transform((s) => s === "on" || s === "true"),
  min_avg_rating: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isFinite(n) && n >= 1 && n <= 5,
      "Average rating must be between 1 and 5",
    ),
  min_reviews_count: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isInteger(n) && n >= 1,
      "At least 1 review is required",
    ),
  period_days: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isInteger(n) && n >= 1 && n <= 365,
      "Period must be between 1 and 365 days",
    ),
  amount_cents: dollarStringToCents,
});

export type BonusRuleInput = z.infer<typeof BonusRuleSchema>;
