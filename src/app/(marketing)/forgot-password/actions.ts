"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";

const EmailSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

export type ForgotPasswordState = {
  errors?: Partial<Record<"email" | "_form", string>>;
  email?: string;
  sent?: boolean;
};

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const raw = String(formData.get("email") ?? "").trim();
  const parsed = EmailSchema.safeParse({ email: raw });

  if (!parsed.success) {
    return {
      errors: { email: parsed.error.issues[0]?.message },
      email: raw,
    };
  }

  // 10/min/IP — slows credential-scraping bots without blocking a legit
  // user who mistypes their address.
  const rl = await checkIpRateLimit("auth-forgot", 10, 60_000);
  if (!rl.allowed) {
    return {
      errors: {
        _form: `Too many requests. Try again in ${rl.retryAfterSeconds} seconds.`,
      },
      email: raw,
    };
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    },
  );

  // Always show success — don't leak whether an account exists.
  if (error) {
    console.error("[auth] resetPasswordForEmail failed:", error.message);
  }

  return { sent: true, email: parsed.data.email };
}
