import { z } from "zod";

/**
 * Validation schema for the invite-employee form.
 */
export const InvitationSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(["admin", "manager", "employee"], {
    message: "Choose a role",
  }),
  pay_rate: z
    .string()
    .transform((s) => {
      if (!s || s.trim() === "") return undefined;
      const cleaned = s.replace(/[$,\s]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n < 0) return undefined;
      return Math.round(n * 100);
    })
    .optional(),
});
