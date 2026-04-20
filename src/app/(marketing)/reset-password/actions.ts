"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";

const ResetSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters"),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  });

export type ResetPasswordState = {
  errors?: Partial<Record<"password" | "confirm_password" | "_form", string>>;
  done?: boolean;
};

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const raw = {
    password: String(formData.get("password") ?? ""),
    confirm_password: String(formData.get("confirm_password") ?? ""),
  };

  const parsed = ResetSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: ResetPasswordState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<
        ResetPasswordState["errors"]
      >;
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { errors: fieldErrors };
  }

  const rl = await checkIpRateLimit("auth-reset", 10, 60_000);
  if (!rl.allowed) {
    return {
      errors: {
        _form: `Too many requests. Try again in ${rl.retryAfterSeconds} seconds.`,
      },
    };
  }

  const supabase = await createSupabaseServerClient();

  // The user already has a session from the auth/callback exchange.
  // We just need to update their password.
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { errors: { _form: error.message } };
  }

  return { done: true };
}
