"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { signupAction, type SignupActionState } from "./actions";

const initialState: SignupActionState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

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
        <Label htmlFor="fullName">Your name</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          defaultValue={state.values?.fullName}
          aria-invalid={Boolean(state.errors?.fullName)}
        />
        {state.errors?.fullName && (
          <p className="text-xs text-destructive">{state.errors.fullName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="organizationName">Company name</Label>
        <Input
          id="organizationName"
          name="organizationName"
          autoComplete="organization"
          required
          defaultValue={state.values?.organizationName}
          aria-invalid={Boolean(state.errors?.organizationName)}
        />
        {state.errors?.organizationName && (
          <p className="text-xs text-destructive">
            {state.errors.organizationName}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={Boolean(state.errors?.email)}
        />
        {state.errors?.email && (
          <p className="text-xs text-destructive">{state.errors.email}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
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
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
