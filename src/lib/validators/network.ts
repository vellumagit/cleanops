import { z } from "zod";
import { optionalText, requiredText } from "./common";

/**
 * Network contacts — the rolodex of non-clients (realtors, property
 * managers, suppliers). Loose by design: unlike the bench, nothing is
 * ever texted automatically, so phone stays free-form ("ask for Dave at
 * the front desk" is a valid way to reach a supplier).
 */

export const NETWORK_CATEGORIES = [
  { key: "realtor", label: "Realtor" },
  { key: "property_manager", label: "Property manager" },
  { key: "supplier", label: "Supplier" },
  { key: "referral_partner", label: "Referral partner" },
  { key: "other", label: "Other" },
] as const;

export type NetworkCategoryKey = (typeof NETWORK_CATEGORIES)[number]["key"];

const CATEGORY_KEYS = NETWORK_CATEGORIES.map((c) => c.key) as [
  NetworkCategoryKey,
  ...NetworkCategoryKey[],
];

export function networkCategoryLabel(key: string): string {
  return NETWORK_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";
}

export const NetworkContactSchema = z.object({
  name: requiredText("Name", 200),
  category: z.enum(CATEGORY_KEYS).default("other"),
  company: optionalText,
  phone: optionalText,
  email: optionalText.refine(
    (s) => !s || /\S+@\S+\.\S+/.test(s),
    "Enter a valid email",
  ),
  notes: optionalText,
});

export type NetworkContactInput = z.infer<typeof NetworkContactSchema>;
