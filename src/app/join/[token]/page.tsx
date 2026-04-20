import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join your team",
  description: "Accept your invitation and join your team on Sollos 3.",
  robots: { index: false, follow: false },
};

/**
 * Public invitation landing page.
 *
 * Reads with the SERVICE-ROLE client because the caller is not yet a
 * Sollos user. The token in the URL IS the capability — unique per invite.
 *
 * States:
 *   - Valid + open     → show org name, role, signup form
 *   - Already accepted → "already joined" message
 *   - Expired          → "expired" message
 *   - Invalid token    → "link not valid" fallback
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const rl = await checkIpRateLimit("join-token", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const admin = createSupabaseAdminClient();

  const { data: invitation } = await admin
    .from("invitations")
    .select(
      `
        id,
        email,
        role,
        expires_at,
        accepted_at,
        organization:organizations ( id, name )
      `,
    )
    .eq("token", token)
    .maybeSingle();

  if (!invitation || !invitation.organization) {
    return (
      <Shell>
        <InvalidState />
      </Shell>
    );
  }

  // Already accepted
  if (invitation.accepted_at) {
    return (
      <Shell>
        <AlreadyJoinedState orgName={invitation.organization.name} />
      </Shell>
    );
  }

  // Expired
  const expired = new Date(invitation.expires_at).getTime() < Date.now();
  if (expired) {
    return (
      <Shell>
        <ExpiredState />
      </Shell>
    );
  }

  // Valid — show the signup form
  return (
    <Shell>
      <OpenState
        token={token}
        email={invitation.email}
        role={invitation.role}
        orgName={invitation.organization.name}
        orgId={invitation.organization.id}
        invitationId={invitation.id}
      />
    </Shell>
  );
}

/* ------------------------------ Layout ------------------------------ */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sollos-wash relative flex flex-1 items-center justify-center px-4 py-10">
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="mx-auto mb-6 flex w-max items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sollos-logo.png"
            alt="Sollos 3"
            className="h-8 w-8 shrink-0 rounded-lg"
          />
          <span className="text-base font-semibold tracking-tight">
            Sollos 3
          </span>
        </Link>
        <div className="sollos-card p-6 shadow-lg shadow-indigo-500/5">
          {children}
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          This invitation link is personal and single-use.
        </p>
      </div>
    </main>
  );
}

/* ------------------------------ States ------------------------------ */

function OpenState({
  token,
  email,
  role,
  orgName,
  orgId,
  invitationId,
}: {
  token: string;
  email: string;
  role: string;
  orgName: string;
  orgId: string;
  invitationId: string;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="sollos-label text-primary">You&apos;re invited</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Join {orgName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;ve been invited as{" "}
          <span className="font-medium text-foreground">
            {role === "admin" ? "an admin" : "an employee"}
          </span>
          . Create your account to get started.
        </p>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center text-sm">
        <span className="text-muted-foreground">Invitation for </span>
        <span className="font-medium text-foreground">{email}</span>
      </div>

      <JoinForm
        token={token}
        email={email}
        orgId={orgId}
        invitationId={invitationId}
        role={role}
      />
    </div>
  );
}

function AlreadyJoinedState({ orgName }: { orgName: string }) {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
        <svg
          className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold tracking-tight">Already joined</h1>
      <p className="text-sm text-muted-foreground">
        This invitation has already been accepted. You&apos;re a member of{" "}
        <span className="font-medium text-foreground">{orgName}</span>.
      </p>
      <Link href="/login">
        <button className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Sign in
        </button>
      </Link>
    </div>
  );
}

function ExpiredState() {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-bold tracking-tight">
        Invitation expired
      </h1>
      <p className="text-sm text-muted-foreground">
        This invitation link has expired. Ask your team admin to send a new
        one.
      </p>
    </div>
  );
}

function InvalidState() {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-bold tracking-tight">Link not valid</h1>
      <p className="text-sm text-muted-foreground">
        This invitation link isn&apos;t recognized. Make sure you&apos;re
        using the full link from the invitation.
      </p>
    </div>
  );
}
