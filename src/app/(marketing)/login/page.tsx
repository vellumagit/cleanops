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
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = params.next ?? "/app";
  const confirmEmail = params.confirm ? params.email : undefined;
  const joinedEmail = params.joined ? params.email : undefined;

  return (
    <main className="sollos-wash relative flex flex-1 items-center justify-center px-6 py-16">
      <div className="sollos-dots absolute inset-0" aria-hidden />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="mx-auto mb-8 flex w-max items-center gap-2"
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
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to your Sollos 3 workspace.
            </p>
          </div>

          {confirmEmail && (
            <div
              role="status"
              className="mb-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary"
            >
              Check <span className="font-semibold">{confirmEmail}</span> for a
              confirmation link before signing in.
            </div>
          )}

          {joinedEmail && (
            <div
              role="status"
              className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400"
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
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Create a workspace
          </Link>
        </p>
      </div>
    </main>
  );
}
