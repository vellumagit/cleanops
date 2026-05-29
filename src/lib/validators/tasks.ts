import { z } from "zod";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

export const TaskRecurrenceEnum = z.enum([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
]);

export const TaskSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(500, "Title must be 500 characters or less")
    .refine(noCardNumber, { message: CARD_DETECTED_MESSAGE }),
  notes: z
    .string()
    .max(5000, "Notes too long")
    .refine(noCardNumber, { message: CARD_DETECTED_MESSAGE })
    .optional()
    .nullable(),
  assigned_to: z.string().uuid("Invalid member").optional().nullable(),
  due_at: z.string().optional().nullable(),
  remind_at: z.string().optional().nullable(),
  recurrence: TaskRecurrenceEnum.optional().nullable(),
});

export type TaskSchemaType = z.infer<typeof TaskSchema>;
