import { z } from "zod";
import { dollarStringToCents, optionalText, requiredText } from "./common";

export const PackageSchema = z.object({
  name: requiredText("Name", 200),
  description: optionalText,
  duration_minutes: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isFinite(n) && n > 0 && n <= 24 * 60,
      "Duration must be between 1 and 1440 minutes",
    ),
  price_cents: dollarStringToCents,
  is_active: z
    .union([z.literal("on"), z.literal("true"), z.literal(""), z.undefined()])
    .transform((v) => v === "on" || v === "true"),
  /**
   * Comma- or newline-separated list of items included in the package.
   * Stored as a JSON string array on the row.
   */
  included: z
    .string()
    .transform((s) =>
      s
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    ),
});

export type PackageInput = z.infer<typeof PackageSchema>;
