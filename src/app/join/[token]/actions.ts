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
  const { data: invitation } = (await admin
    .from("invitations")
    .select(
      "id, email, role, engagement, pay_rate_cents, expires_at, accepted_at, organization_id",
    )
    .eq("id", meta.invitationId)
    .eq("token", meta.token)
    .maybeSingle()) as unknown as {
    // engagement + pay_rate_cents postdate the generated types.
    data: {
      id: string;
      email: string;
      role: "owner" | "admin" | "manager" | "employee";
      engagement: string | null;
      pay_rate_cents: number | null;
      expires_at: string;
      accepted_at: string | null;
      organization_id: string;
    } | null;
  };

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

  // The membership write lives in claimInvitation — the ONE code path all
  // three accept pages share, so wage/engagement/training can't drift apart
  // between them again.
  const { claimInvitation } = await import("@/lib/invitation-claim");

  if (existingUser) {
    // User already has an account — claim with their existing identity.
    const claimed = await claimInvitation(admin, invitation, existingUser.id);
    if (!claimed.ok) {
      return {
        errors: { _form: claimed.error },
        values: { full_name: raw.full_name },
      };
    }
    if (claimed.alreadyActive) {
      return {
        errors: { _form: "You're already a member of this organization. Sign in to continue." },
        values: { full_name: raw.full_name },
      };
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

    const claimed = await claimInvitation(
      admin,
      invitation,
      signUpData.user.id,
    );
    if (!claimed.ok) {
      // Cleanup: delete the user we just created
      await admin.auth.admin.deleteUser(signUpData.user.id);
      return {
        errors: { _form: claimed.error },
        values: { full_name: raw.full_name },
      };
    }
  }

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
