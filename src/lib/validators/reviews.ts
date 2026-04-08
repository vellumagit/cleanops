import { z } from "zod";
import { optionalText } from "./common";

export const ReviewSchema = z.object({
  booking_id: z
    .string()
    .transform((s) => (s && s !== "" ? s : undefined))
    .optional(),
  client_id: z.string().uuid("Pick a client"),
  employee_id: z
    .string()
    .transform((s) => (s && s !== "" ? s : undefined))
    .optional(),
  rating: z
    .string()
    .transform((s) => Number(s))
    .refine(
      (n) => Number.isInteger(n) && n >= 1 && n <= 5,
      "Rating must be 1–5",
    ),
  comment: optionalText,
});

export type ReviewInput = z.infer<typeof ReviewSchema>;
