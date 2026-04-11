"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const JoinSchema = z.object({
  full_name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type JoinFormState = {
  errors?: Partial<Record<"full_name" | "password" | "_form", string>>;
  values?: { full_name?: string };
};

export async function acceptInvitationAction(
  meta: {
    token: string;
    email: string;
    orgId: string;
    invitationId: string;
    role: string;
  },
  _prev: JoinFormState,
  formData: FormData,
): Promise<JoinFormState> {
  const raw = {
    full_name: String(formData.get("full_name") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };

  const parsed = JoinSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "_form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { errors, values: { full_name: raw.full_name } };
  }

  const admin = createSupabaseAdminClient();

  // Re-verify the invitation is still valid
  const { data: invitation } = await admin
    .from("invitations")
    .select("id, email, role, expires_at, accepted_at, organization_id")
    .eq("id", meta.invitationId)
    .eq("token", meta.token)
    .maybeSingle();

  if (!invitation) {
    return {
      errors: { _form: "This invitation link is no longer valid." },
      values: { full_name: raw.full_name },
    };
  }

  if (invitation.accepted_at) {
    return {
      errors: { _form: "This invitation has already been accepted." },
      values: { full_name: raw.full_name },
    };
  }

  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    return {
      errors: { _form: "This invitation has expired. Ask your admin to send a new one." },
      values: { full_name: raw.full_name },
    };
  }

  // Check if user with this email already exists
  const { data: existingUsers } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  const existingUser = existingUsers?.users.find(
    (u) => u.email?.toLowerCase() === invitation.email.toLowerCase(),
  );

  let userId: string;

  if (existingUser) {
    // User already has an account — just create membership
    userId = existingUser.id;

    // Check if they already have a membership in this org
    const { data: existingMembership } = await admin
      .from("memberships")
      .select("id, status")
      .eq("organization_id", invitation.organization_id)
      .eq("profile_id", userId)
      .maybeSingle();

    if (existingMembership && existingMembership.status === "active") {
      // Mark invitation as accepted and redirect
      await admin
        .from("invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);

      return {
        errors: { _form: "You're already a member of this organization. Sign in to continue." },
        values: { full_name: raw.full_name },
      };
    }

    if (existingMembership && existingMembership.status === "disabled") {
      // Re-activate the membership
      await admin
        .from("memberships")
        .update({
          status: "active",
          role: invitation.role,
        })
        .eq("id", existingMembership.id);
    } else if (!existingMembership) {
      // Create new membership
      const { error: membershipErr } = await admin
        .from("memberships")
        .insert({
          organization_id: invitation.organization_id,
          profile_id: userId,
          role: invitation.role,
          status: "active",
        });

      if (membershipErr) {
        return {
          errors: { _form: membershipErr.message },
          values: { full_name: raw.full_name },
        };
      }
    }
  } else {
    // Create a new auth user
    // The on_auth_user_created trigger will create a profile row
    const supabase = await createSupabaseServerClient();
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp(
      {
        email: invitation.email,
        password: parsed.data.password,
        options: {
          data: { full_name: parsed.data.full_name },
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        },
      },
    );

    if (signUpError || !signUpData.user) {
      return {
        errors: { _form: signUpError?.message ?? "Could not create account." },
        values: { full_name: raw.full_name },
      };
    }

    userId = signUpData.user.id;

    // Create membership using admin client (RLS won't allow new users to
    // insert into memberships)
    const { error: membershipErr } = await admin
      .from("memberships")
      .insert({
        organization_id: invitation.organization_id,
        profile_id: userId,
        role: invitation.role,
        status: "active",
      });

    if (membershipErr) {
      // Cleanup: delete the user we just created
      await admin.auth.admin.deleteUser(userId);
      return {
        errors: { _form: membershipErr.message },
        values: { full_name: raw.full_name },
      };
    }
  }

  // Mark invitation as accepted
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // If the user has an active session (signUp with email confirm off),
  // redirect to the appropriate place
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // User is signed in — redirect based on role
    if (invitation.role === "employee") {
      redirect("/field");
    }
    redirect("/app");
  }

  // If email confirmation is required, send them to login
  redirect(`/login?joined=1&email=${encodeURIComponent(invitation.email)}`);
}
