import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create your Sollos 3 workspace.",
};

export default function SignupPage() {
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
              Create your workspace
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Get started in 30 seconds.
            </p>
          </div>

          <SignupForm />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
