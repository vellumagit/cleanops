"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SignupSchema, slugify } from "@/lib/validators/auth";

export type SignupActionState = {
  errors?: Partial<Record<"fullName" | "organizationName" | "email" | "password" | "_form", string>>;
  values?: { fullName?: string; organizationName?: string; email?: string };
};

export async function signupAction(
  _prevState: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const raw = {
    fullName: String(formData.get("fullName") ?? "").trim(),
    organizationName: String(formData.get("organizationName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };

  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: SignupActionState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<SignupActionState["errors"]>;
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      errors: fieldErrors,
      values: {
        fullName: raw.fullName,
        organizationName: raw.organizationName,
        email: raw.email,
      },
    };
  }

  const { fullName, organizationName, email, password } = parsed.data;
  const supabase = await createSupabaseServerClient();

  // Step 1: create the auth user. The on_auth_user_created trigger will
  // insert a profiles row automatically.
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (signUpError || !signUpData.user) {
    return {
      errors: { _form: signUpError?.message ?? "Could not create account" },
      values: { fullName, organizationName, email },
    };
  }

  const userId = signUpData.user.id;

  // Step 2: create the organization and the owner membership atomically,
  // using the service-role client because the user can't insert into
  // organizations directly (RLS allows reads/updates only for members).
  const admin = createSupabaseAdminClient();

  // Build a unique slug — append a short suffix on collision.
  let slug = slugify(organizationName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${slugify(organizationName)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: organizationName, slug })
    .select("id")
    .single();

  if (orgError || !org) {
    // Roll back the auth user so they can try again with the same email.
    await admin.auth.admin.deleteUser(userId);
    return {
      errors: {
        _form: orgError?.message ?? "Could not create organization",
      },
      values: { fullName, organizationName, email },
    };
  }

  const { error: membershipError } = await admin.from("memberships").insert({
    organization_id: org.id,
    profile_id: userId,
    role: "owner",
    status: "active",
  });

  if (membershipError) {
    // Best-effort cleanup
    await admin.from("organizations").delete().eq("id", org.id);
    await admin.auth.admin.deleteUser(userId);
    return {
      errors: { _form: membershipError.message },
      values: { fullName, organizationName, email },
    };
  }

  // If email confirmation is required, signUp returned a user with no
  // active session. Send them to a check-your-email screen.
  if (!signUpData.session) {
    redirect(`/login?confirm=1&email=${encodeURIComponent(email)}`);
  }

  // Otherwise (email confirmation off in Supabase), they're already signed in.
  redirect("/app");
}
