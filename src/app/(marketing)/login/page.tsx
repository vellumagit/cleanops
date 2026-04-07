import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your CleanOps workspace.",
};

type SearchParams = Promise<{
  next?: string;
  confirm?: string;
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

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Sign in to CleanOps
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Welcome back.
          </p>
        </div>

        {confirmEmail && (
          <div
            role="status"
            className="mb-4 rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            Check <span className="font-medium">{confirmEmail}</span> for a
            confirmation link before signing in.
          </div>
        )}

        <LoginForm next={next} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to CleanOps?{" "}
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
