"use client";

import { useActionState } from "react";
import Link from "next/link";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  resetPasswordAction,
  type ResetPasswordState,
} from "./actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    initialState,
  );

  if (state.done) {
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
        <h2 className="text-lg font-semibold">Password updated</h2>
        <p className="text-sm text-muted-foreground">
          Your password has been changed. You&apos;re now signed in.
        </p>
        {/* href="/" (not "/app") so the homepage's role-aware redirect
            routes employees to /field/jobs. And the Link is styled
            directly with buttonVariants instead of wrapping a Button —
            <a><button> is invalid HTML and the click never navigated,
            which is exactly the "button is inactive" report we got
            from an employee resetting their password. */}
        <Link
          href="/"
          className={cn(buttonVariants({ size: "lg" }), "mt-2 w-full")}
        >
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?._form && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {state.errors._form}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={Boolean(state.errors?.password)}
        />
        {state.errors?.password && (
          <p className="text-xs text-destructive">{state.errors.password}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm_password">Confirm password</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={Boolean(state.errors?.confirm_password)}
        />
        {state.errors?.confirm_password && (
          <p className="text-xs text-destructive">
            {state.errors.confirm_password}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
