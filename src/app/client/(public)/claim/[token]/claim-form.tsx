"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { acceptPortalInviteAction } from "@/app/app/clients/portal-actions";

export function ClaimForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    startTransition(async () => {
      // Server consumes the token, creates/updates the auth user, links
      // the client record.
      const res = await acceptPortalInviteAction(token, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Server linked the auth user + client record. We don't have the
      // email on the client here, so send them to /client/login to sign
      // in once and establish their session.
      router.push("/client/login?claimed=1");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="pw">New password</Label>
        <PasswordInput
          id="pw"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <p className="text-[11px] text-muted-foreground">
          At least 8 characters.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw2">Confirm password</Label>
        <PasswordInput
          id="pw2"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Finishing…" : "Set password"}
      </Button>
    </form>
  );
}
