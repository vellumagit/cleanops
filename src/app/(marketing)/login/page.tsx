import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Sollos 3 workspace.",
};

type SearchParams = Promise<{
  next?: string;
  confirm?: string;
  joined?: string;
  email?: string;
  auth_error?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = params.next ?? "";
  const confirmEmail = params.confirm ? params.email : undefined;
  const joinedEmail = params.joined ? params.email : undefined;
  const authError = params.auth_error;

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

          {authError && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              Email confirmation failed. The link may have expired — try
              signing in below and a new confirmation email will be sent.
            </div>
          )}

          {confirmEmail && (
            <div
              role="status"
              className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
            >
              Check <span className="font-semibold">{confirmEmail}</span> for a
              confirmation link before signing in.
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
      </div>
    </main>
  );
}
