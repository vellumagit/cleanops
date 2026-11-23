"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";
import { DoorButton, DoorNote } from "../door";
import { requestClientSignInAction, type SignInLinkState } from "./actions";

const empty: SignInLinkState = {};

/**
 * Client sign-in: an email address and one button.
 *
 * A cleaning client opens this a handful of times a year, which is exactly
 * how often nobody remembers a password. So there isn't one to remember:
 * they type their email, we send a button, they press it. Since 2026-11-22
 * that works for anyone on a company's books, with no invite first
 * (lib/client-sign-in.ts).
 *
 * A password still works for the few who set one before then. It sits
 * behind a small link, out of the way of everyone else.
 */
export function ClientLoginForm({ next }: { next?: string | null }) {
  const router = useRouter();
  const dest = next ?? "/client";
  const [state, sendLink, sending] = useActionState(requestClientSignInAction, empty);
  const [email, setEmail] = useState("");
  // "Use a different email" puts the form back without a round trip.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        setPwError(
          /invalid login credentials/i.test(error.message) || error.code === "invalid_credentials"
            ? "That email and password don't match. It's easier to have a link emailed to you: go back and press Email me a link."
            : friendlyAuthError(error, "sign-in"),
        );
        return;
      }
      router.push(dest);
      router.refresh();
    });
  }

  function sendReset() {
    setPwError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/client/reset`,
      });
      // Only a rate limit is worth saying; anything else would tell a
      // stranger something about this address.
      if (error && /rate limit/i.test(error.message)) {
        setPwError(friendlyAuthError(error, "magic-link"));
        return;
      }
      setResetSent(true);
    });
  }

  if (state.sentTo && state.sentTo !== dismissedFor) {
    return (
      <div className="space-y-4">
        <DoorNote tone="green">
          <p className="text-lg font-semibold">Check your email.</p>
          <p className="mt-1">
            If <span className="font-semibold [overflow-wrap:anywhere]">{state.sentTo}</span> is the address your
            cleaner has for you, a message is on its way. Open it and press <strong>Open my cleans</strong>.
          </p>
        </DoorNote>
        <p className="text-sm text-muted-foreground">
          It can take a minute. Look in your junk or spam folder too. The button in it works for one hour.
        </p>
        <button
          type="button"
          className="text-base font-medium underline underline-offset-4"
          onClick={() => setDismissedFor(state.sentTo ?? null)}
        >
          Use a different email
        </button>
      </div>
    );
  }

  if (withPassword) {
    return (
      <form onSubmit={signIn} className="space-y-4">
        {pwError && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
            {pwError}
          </div>
        )}
        {resetSent && (
          <DoorNote tone="green">If that address has a password, a message to set a new one is on its way.</DoorNote>
        )}
        <label className="block space-y-1.5">
          <span className="text-base font-medium">Your email</span>
          <Input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 text-base" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-base font-medium">Password</span>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 text-base" />
        </label>
        <DoorButton disabled={pending}>{pending ? "Signing in…" : "Sign in"}</DoorButton>
        <div className="flex flex-col items-start gap-3 pt-1 text-base">
          <button type="button" className="font-medium underline underline-offset-4" onClick={() => setWithPassword(false)}>
            Email me a link instead
          </button>
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-4 disabled:opacity-50"
            onClick={sendReset}
            disabled={pending || !email.trim()}
          >
            I forgot my password
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={sendLink} className="space-y-4">
      {state.error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
          {state.error}
        </div>
      )}
      <label className="block space-y-1.5">
        <span className="text-base font-medium">Your email</span>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="h-12 text-base"
        />
      </label>
      <DoorButton disabled={sending}>{sending ? "Sending…" : "Email me a link"}</DoorButton>
      <p className="text-sm text-muted-foreground">
        Use the email your cleaner has for you. We send you a button; press it and you&rsquo;re in. There is no
        password to remember.
      </p>
      <button
        type="button"
        className="text-sm text-muted-foreground underline underline-offset-4"
        onClick={() => setWithPassword(true)}
      >
        I have a password
      </button>
    </form>
  );
}
