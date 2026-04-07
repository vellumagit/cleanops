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
  const next = String(formData.get("next") ?? "/app");

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

  // Only allow internal redirects, never external URLs
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  redirect(safeNext);
}
