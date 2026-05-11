import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * /join?token=<invite_token>
 *
 * Accepts a team invite for an already-authenticated user.
 *
 * Flow:
 *  1. User is sent /login?invite=<token> from the invite email.
 *  2. Login page sets `next=/join?token=<token>` so after sign-in we land here.
 *  3. We look up the invitation, create the membership, and redirect.
 *
 * If the user is NOT logged in, they're bounced to /login?invite=<token>.
 * If the token is invalid/expired they see a plain error message.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) redirect("/login");

  const supabase = await createSupabaseServerClient();

  // Must be authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?invite=${token}`);
  }

  const admin = createSupabaseAdminClient();

  // Look up the invitation — use admin so RLS doesn't block
  const { data: invite } = (await admin
    .from("invitations")
    .select("id, organization_id, email, role, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      email: string;
      role: string;
      expires_at: string;
      accepted_at: string | null;
    } | null;
  };

  if (!invite) {
    return <ErrorPage message="This invite link is invalid or has already been used." />;
  }

  if (invite.accepted_at) {
    // Already accepted — just redirect to the right app
    redirect(invite.role === "employee" ? "/field/jobs" : "/app");
  }

  if (new Date(invite.expires_at) < new Date()) {
    return <ErrorPage message="This invite link has expired. Ask your admin to send a new one." />;
  }

  // Check the user doesn't already have an active membership in this org
  const { data: existingMembership } = await admin
    .from("memberships")
    .select("id, status")
    .eq("organization_id", invite.organization_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (existingMembership?.status === "active") {
    redirect(invite.role === "employee" ? "/field/jobs" : "/app");
  }

  if (existingMembership?.status === "disabled") {
    // Re-activate
    await admin
      .from("memberships")
      .update({ status: "active" } as never)
      .eq("id", existingMembership.id);
  } else {
    // Create the membership
    const { error: membershipError } = await admin.from("memberships").insert({
      organization_id: invite.organization_id,
      profile_id: user.id,
      role: invite.role as "owner" | "admin" | "manager" | "employee",
      status: "active",
    });

    if (membershipError) {
      return <ErrorPage message="Could not join team. Please try again or contact support." />;
    }
  }

  // Mark invite as accepted
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() } as never)
    .eq("id", invite.id);

  // Set the new org as the active org cookie
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.set("sollos_active_org", invite.organization_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect(invite.role === "employee" ? "/field/jobs" : "/app");
}

function ErrorPage({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Invite error</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <a
          href="/login"
          className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
        >
          Back to sign in
        </a>
      </div>
    </main>
  );
}
