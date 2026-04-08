import { z } from "zod";
import { optionalText, requiredText } from "./common";

export const ProfileSchema = z.object({
  full_name: requiredText("Full name", 120),
  phone: optionalText,
});

export type ProfileInput = z.infer<typeof ProfileSchema>;
