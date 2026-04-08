import { z } from "zod";
import { optionalText, requiredText } from "./common";

export const InventoryCategoryEnum = z.enum([
  "chemical",
  "equipment",
  "consumable",
]);

const intString = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Required")
  .refine((s) => /^-?\d+$/.test(s), "Must be a whole number")
  .transform((s) => Number.parseInt(s, 10));

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

export const InventorySchema = z.object({
  name: requiredText("Name", 200),
  category: InventoryCategoryEnum,
  quantity: intString.refine((n) => n >= 0, "Cannot be negative"),
  reorder_threshold: intString.refine((n) => n >= 0, "Cannot be negative"),
  assigned_to: optionalUuid,
  notes: optionalText,
});

export type InventoryInput = z.infer<typeof InventorySchema>;
