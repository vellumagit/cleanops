import { z } from "zod";

export const SignupSchema = z.object({
  fullName: z
    .string()
    .min(1, "Your name is required")
    .max(120, "Name is too long"),
  organizationName: z
    .string()
    .min(1, "Company name is required")
    .max(120, "Company name is too long"),
  email: z.string().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});

export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Slugifies a company name for use as the org slug.
 * Lowercase, alphanumeric + hyphens, 2-60 chars.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (base.length < 2) {
    return `org-${Math.random().toString(36).slice(2, 8)}`;
  }
  return base;
}
