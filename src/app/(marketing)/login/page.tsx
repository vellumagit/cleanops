import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authUserExistsForEmail } from "@/lib/portal-claim";
import { isAuthCallbackFailure } from "@/lib/auth-callback-failure";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Sollos 3 workspace.",
  // An auth form is nothing to rank; keep it out of the index.
  robots: { index: false, follow: true },
};

type SearchParams = Promise<{
  next?: string;
  confirm?: string;
  joined?: string;
  email?: string;
  auth_error?: string;
  invite?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // If arriving via a team invite for an existing account, redirect to the
  // invite-accept page after login rather than the default dashboard.
  const inviteToken = params.invite;
  const next = inviteToken
    ? `/join?token=${inviteToken}`
    : (params.next ?? "");

  // Say WHY this is a sign-in and not a sign-up: the invite email chose this
  // page because the address already has a Sollos login — often one the
  // person has forgotten (a client-portal test, an old trial). Without the
  // address and the way out, "sign in with your existing account" read as a
  // dead end to someone sure they had none (Brian, 2026-11-09). The token is
  // the capability, same as /join/[token]; the lookup is best-effort.
  let invited: { email: string; orgName: string | null } | null = null;
  if (inviteToken) {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("invitations")
      .select("email, organization:organizations ( name )")
      .eq("token", inviteToken)
      .maybeSingle()) as unknown as {
      data: { email: string; organization: { name: string } | null } | null;
    };
    if (data) invited = { email: data.email, orgName: data.organization?.name ?? null };
    // The email picked sign-in or sign-up when it was SENT. Accounts come and
    // go in between (a stale test login deleted, a fresh one made); decide
    // again from what exists now, so a link never strands anyone on the
    // wrong form. The signup page does the mirror image.
    if (invited && !(await authUserExistsForEmail(admin, invited.email))) {
      redirect(`/signup?invite=${inviteToken}`);
    }
  }
  const confirmEmail = params.confirm ? params.email : undefined;
  const joinedEmail = params.joined ? params.email : undefined;
  // Any other value (an old link, a hand-typed URL) reads as the generic one.
  const authError = params.auth_error
    ? isAuthCallbackFailure(params.auth_error)
      ? params.auth_error
      : "confirmation_failed"
    : undefined;

  return (
    <main className="sollos-wash relative flex flex-1 items-center justify-center px-6 py-16">
      <div className="sollos-dots absolute inset-0" aria-hidden />

      <div className="relative z-10 w-full max-w-sm">
        <Link
          href="/"
          className="mx-auto mb-8 flex w-max items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sollos-logo.png"
            alt="Sollos 3"
            className="h-7 w-7 shrink-0 rounded-md"
          />
          <span className="text-sm font-semibold tracking-tight">
            Sollos 3
          </span>
        </Link>

        <div className="sollos-card p-6">
          <div className="mb-6">
            <h1 className="text-lg font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sign in to your workspace.
            </p>
          </div>

          {inviteToken && (
            <div
              role="status"
              className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700"
            >
              {invited ? (
                <>
                  You&apos;ve been invited to join{" "}
                  <span className="font-semibold">{invited.orgName ?? "a team"}</span> on
                  Sollos. There&apos;s already a Sollos account for{" "}
                  <span className="font-semibold">{invited.email}</span>, so sign in with it
                  to accept. Don&apos;t know its password? Use &ldquo;Forgot password?&rdquo;
                  below, then open the invite link again.
                </>
              ) : (
                <>
                  You&apos;ve been invited to join a team on Sollos. Sign in with your
                  existing account to accept. Don&apos;t know the password? Use &ldquo;Forgot
                  password?&rdquo; below, then open the invite link again.
                </>
              )}
            </div>
          )}

          {authError === "other_browser" && (
            <div
              role="status"
              className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
            >
              Your email is confirmed. The link opened in a different browser
              from the one you signed up in, so sign in below to continue.
            </div>
          )}

          {authError === "reset_other_browser" && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              That reset link opened in a different browser from the one you
              asked for it in. Use &ldquo;Forgot password?&rdquo; below for a
              new link, and open it on this device.
            </div>
          )}

          {authError === "confirmation_failed" && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              That link has expired or was already used. If you&apos;ve
              confirmed your email before, sign in below.
            </div>
          )}

          {confirmEmail && (
            <div
              role="status"
              className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
            >
              Check <span className="font-semibold">{confirmEmail}</span> for a
              confirmation link before signing in. Already have an account with
              this email? Sign in below, or use &ldquo;Forgot password?&rdquo;.
            </div>
          )}

          {joinedEmail && (
            <div
              role="status"
              className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
            >
              Account created! Confirm your email at{" "}
              <span className="font-semibold">{joinedEmail}</span>, then sign
              in below.
            </div>
          )}

          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to Sollos 3?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create a workspace
          </Link>
        </p>
        {/* Clients have their own door. Nothing here said so, and a client
            who signed in on this page with a staff login landed in the
            office. */}
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
          Here to see your cleaner? This page is for the cleaning company&rsquo;s staff.{" "}
          <Link
            href="/client/login"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            See your cleans
          </Link>
        </p>
      </div>
    </main>
  );
}
