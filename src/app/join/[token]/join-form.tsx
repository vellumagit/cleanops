"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction, type JoinFormState } from "./actions";

const initialState: JoinFormState = {};

export function JoinForm({
  token,
  email,
  orgId,
  invitationId,
  role,
}: {
  token: string;
  email: string;
  orgId: string;
  invitationId: string;
  role: string;
}) {
  const boundAction = acceptInvitationAction.bind(null, {
    token,
    email,
    orgId,
    invitationId,
    role,
  });

  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState,
  );

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
        <Label htmlFor="full_name">Your name</Label>
        <Input
          id="full_name"
          name="full_name"
          autoComplete="name"
          required
          defaultValue={state.values?.full_name}
          aria-invalid={Boolean(state.errors?.full_name)}
        />
        {state.errors?.full_name && (
          <p className="text-xs text-destructive">{state.errors.full_name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="join-email">Email</Label>
        <Input
          id="join-email"
          type="email"
          value={email}
          disabled
          className="bg-muted"
        />
        <p className="text-xs text-muted-foreground">
          Your account will use this email address.
        </p>
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
        {pending ? "Joining…" : "Create account & join"}
      </Button>
    </form>
  );
}
