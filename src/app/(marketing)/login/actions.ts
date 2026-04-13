"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginSchema } from "@/lib/validators/auth";

export type LoginActionState = {
  errors?: Partial<Record<"email" | "password" | "_form", string>>;
  values?: { email?: string };
};

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

  // If the caller specified an explicit redirect (e.g. ?next=/field), use it
  if (next && next.startsWith("/") && !next.startsWith("//")) {
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
