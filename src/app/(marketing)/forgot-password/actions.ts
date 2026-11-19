"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import {
  checkIpRateLimit,
  checkEmailRateLimit,
} from "@/lib/rate-limit-helpers";

const EmailSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

export type ForgotPasswordState = {
  errors?: Partial<Record<"email" | "_form", string>>;
  email?: string;
  sent?: boolean;
};

/**
 * Detect a Supabase Auth rate-limit error so we can surface a friendly
 * "try again in X minutes" instead of silently pretending success. Safe
 * to leak — rate-limit hits don't reveal whether the account exists
 * (they fire on any email).
 */
function isSupabaseRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("rate limit") ||
    m.includes("rate_limit") ||
    m.includes("too many requests") ||
    m.includes("429")
  );
}

/**
 * Send a reset link that works in whatever browser opens it.
 *
 * The built-in reset email is tied to the browser that asked for it. Someone
 * who asks from the installed app on a phone gets a link that opens in
 * Safari, which never asked, so it was refused ("opened in a different
 * browser"). This link carries its own one-time token instead, the same kind
 * the office's "recovery link" for an employee uses.
 *
 * Returns false when it could not be sent (no such login, email not set up,
 * address suppressed); the caller then falls back to the built-in email, so
 * this can only add a working path, not remove one.
 */
async function sendPortableResetLink(email: string, siteUrl: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) return false;
    const url = `${siteUrl}/auth/callback?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=/reset-password`;
    return await sendEmail({
      to: email,
      subject: "Reset your Sollos password",
      text:
        `Someone asked to reset the password for this Sollos login.\n\n` +
        `Open this link to choose a new password:\n${url}\n\n` +
        `The link works once and expires. It can be opened in any browser. ` +
        `If you use the Sollos app on your phone, set the new password, then sign in to the app with it.\n\n` +
        `If you didn't ask for this, ignore this email. Your password has not changed.`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">` +
        `<p>Someone asked to reset the password for this Sollos login.</p>` +
        `<p><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Choose a new password</a></p>` +
        `<p style="color:#555;font-size:13px">The link works once and expires. It can be opened in any browser. If you use the Sollos app on your phone, set the new password, then sign in to the app with it.</p>` +
        `<p style="color:#555;font-size:13px">If you didn't ask for this, ignore this email. Your password has not changed.</p>` +
        `</div>`,
    });
  } catch (err) {
    console.error("[auth] portable reset link failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  enterFailClosed();
  const raw = String(formData.get("email") ?? "").trim();
  const parsed = EmailSchema.safeParse({ email: raw });

  if (!parsed.success) {
    return {
      errors: { email: parsed.error.issues[0]?.message },
      email: raw,
    };
  }

  // Two layers of rate limiting:
  //   1. Per-IP — slows credential-scraping bots cycling emails.
  //   2. Per-email — one user mashing the button can't burn the whole
  //      Supabase/Resend project quota for everyone else (which is
  //      exactly what happened 2026-06-01: multiple manual retries on
  //      one address hit Supabase's project-wide email cap and locked
  //      out a real employee mid-reset).
  //
  // 10/min/IP and 3/15min/email are both intentionally lenient for
  // legitimate use (a user genuinely retrying after a typo) while
  // strict enough to stop quota-burning abuse.
  const ipRl = await checkIpRateLimit("auth-forgot", 10, 60_000);
  if (!ipRl.allowed) {
    return {
      errors: {
        _form: `Too many requests. Try again in ${ipRl.retryAfterSeconds} seconds.`,
      },
      email: raw,
    };
  }

  const emailRl = await checkEmailRateLimit(
    "auth-forgot",
    parsed.data.email,
    3,
    15 * 60_000,
  );
  if (!emailRl.allowed) {
    const minutes = Math.ceil(emailRl.retryAfterSeconds / 60);
    return {
      errors: {
        _form: `Too many reset requests for this email. Try again in ${minutes} minute${
          minutes === 1 ? "" : "s"
        }.`,
      },
      email: raw,
    };
  }

  const supabase = await createSupabaseServerClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  if (await sendPortableResetLink(parsed.data.email, siteUrl)) {
    return { sent: true, email: parsed.data.email };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    },
  );

  // Default: always show success — don't leak whether an account exists.
  // EXCEPTION: rate-limit errors don't reveal account existence (they
  // trigger on any submission) and are actionable to the user, so we
  // surface them with the actual reason. Without this carveout, a real
  // user facing the project-wide cap from Supabase silently sees
  // "check your email" forever and never gets the email — the exact
  // failure mode we hit 2026-06-01.
  if (error) {
    console.error("[auth] resetPasswordForEmail failed:", error.message);
    if (isSupabaseRateLimitError(error.message)) {
      return {
        errors: {
          _form:
            "Our system is temporarily limiting password reset emails. Please try again in about an hour, or contact support if you're locked out.",
        },
        email: raw,
      };
    }
    // Any other error (network, malformed config) — still don't leak
    // whether the account exists. Return generic success.
  }

  return { sent: true, email: parsed.data.email };
}
