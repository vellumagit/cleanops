"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginSchema } from "@/lib/validators/auth";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";

export type LoginActionState = {
  errors?: Partial<Record<"email" | "password" | "_form", string>>;
  values?: { email?: string };
};

/**
 * Whitelist of safe post-login redirect targets. Any `?next=` value that
 * doesn't match exactly (or isn't a sub-path of) one of these is dropped
 * and the user falls through to the role-based default.
 *
 * Keep this list tight. If a new public area needs a post-login deep
 * link, add its prefix here — never accept arbitrary paths.
 */
const SAFE_NEXT_PREFIXES = ["/app", "/field"];

function isSafeNextPath(next: string): boolean {
  // Must be a plain absolute path. No scheme, no protocol-relative,
  // no backslash tricks, no percent-encoded slashes that might decode
  // to "//". Explicit character checks reject most browser-normalization
  // gotchas.
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/\\")) return false;
  if (next.includes("\\")) return false;
  if (/%2f/i.test(next) || /%5c/i.test(next)) return false;

  // Must match an allowed root, either exactly or as a subpath.
  return SAFE_NEXT_PREFIXES.some(
    (prefix) => next === prefix || next.startsWith(`${prefix}/`),
  );
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const raw = {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
  const next = String(formData.get("next") ?? "");

  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: LoginActionState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<LoginActionState["errors"]>;
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { errors: fieldErrors, values: { email: raw.email } };
  }

  // 10/min/IP — stops credential-stuffing brute force. Supabase itself
  // rate-limits by user but that's per-email; we need an IP cap to stop
  // someone trying many emails against our endpoint.
  const rl = await checkIpRateLimit("auth-login", 10, 60_000);
  if (!rl.allowed) {
    return {
      errors: {
        _form: `Too many login attempts. Try again in ${rl.retryAfterSeconds} seconds.`,
      },
      values: { email: parsed.data.email },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      errors: { _form: error.message },
      values: { email: parsed.data.email },
    };
  }

  // If the caller specified an explicit redirect (e.g. ?next=/field), use it.
  //
  // Allowlist-only to prevent open-redirect phishing. The previous check
  // (`startsWith("/") && !startsWith("//")`) could be bypassed by
  // backslash-path tricks that some browsers normalize into a protocol-
  // relative URL (e.g. "/\example.com" → "//example.com"). Only known
  // first-party roots are allowed here.
  if (next && isSafeNextPath(next)) {
    redirect(next);
  }

  // Otherwise, look up the user's role and redirect accordingly.
  // Prefer the highest-privilege membership so an owner who is also
  // listed as an employee in another org still lands on the dashboard.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(10);

  const roles = (memberships ?? []).map((m) => m.role);
  const hasAdminAccess =
    roles.includes("owner") ||
    roles.includes("admin") ||
    roles.includes("manager");

  if (hasAdminAccess) {
    redirect("/app");
  }

  // Pure employee — send to the field app
  if (roles.length > 0) {
    redirect("/field");
  }

  // No membership at all — send to onboarding
  redirect("/app");
}
