import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Set new password",
  description: "Choose a new password for your Sollos 3 account.",
};

export default function ResetPasswordPage() {
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
              Set new password
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a strong password for your account.
            </p>
          </div>

          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
