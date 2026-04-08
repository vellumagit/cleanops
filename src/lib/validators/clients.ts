import { z } from "zod";
import { optionalText, requiredText } from "./common";

export const PreferredContactEnum = z.enum(["phone", "email", "sms"]);

export const ClientSchema = z.object({
  name: requiredText("Name", 200),
  email: optionalText.refine(
    (s) => !s || /\S+@\S+\.\S+/.test(s),
    "Enter a valid email",
  ),
  phone: optionalText,
  address: optionalText,
  notes: optionalText,
  preferred_contact: PreferredContactEnum,
});

export type ClientInput = z.infer<typeof ClientSchema>;
