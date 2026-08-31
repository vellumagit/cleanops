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
    .select(
      "id, organization_id, email, role, engagement, pay_rate_cents, expires_at, accepted_at",
    )
    .eq("token", token)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      email: string;
      role: "owner" | "admin" | "manager" | "employee";
      engagement: string | null;
      pay_rate_cents: number | null;
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

  // WRONG-ACCOUNT GUARD. This page claims for whoever is signed in, and the
  // claim can now LINK the invitee's existing (shadow) record — grafting it
  // onto a stranger's login if a forwarded link is opened on a shared device
  // or while signed into an unrelated account. The invite is addressed to an
  // email; require the session to match it.
  if ((user.email ?? "").toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <ErrorPage
        message={`This invite was sent to ${invite.email}, but you're signed in as ${user.email ?? "a different account"}. Sign out, then open the invite link again.`}
      />
    );
  }

  // The shared accept path: applies role, engagement, and wage from the
  // invite, reactivates a disabled membership (re-hire, invite's terms win),
  // links a matching shadow record instead of duplicating the person, and
  // assigns onboarding training. This page used to insert role-only —
  // a subcontractor accepting from the email became an employee and landed
  // in the next payroll run.
  const { claimInvitation } = await import("@/lib/invitation-claim");
  const claimed = await claimInvitation(admin, invite, user.id);

  if (!claimed.ok) {
    return <ErrorPage message="Could not join team. Please try again or contact support." />;
  }

  // Set the new org as the active org cookie. Cookie name must match
  // the constant in src/lib/auth.ts (ACTIVE_ORG_COOKIE) — previously
  // we wrote "sollos_active_org" here but the auth helper reads
  // "cleanops_active_org", which meant a user accepting an invite
  // while logged into a different org would have their new org
  // silently ignored on multi-org accounts.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.set("cleanops_active_org", invite.organization_id, {
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
