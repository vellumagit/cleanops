"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Client sign-in.
 *
 * A cleaning client opens this a handful of times a year, which is exactly the
 * frequency at which nobody remembers a password. So the emailed link is the
 * primary route and the password is the fallback, not the other way round —
 * the first version offered only a password, with no reset and no link, so a
 * client who guessed wrong had no way forward at all.
 */
export function ClientLoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"link" | "password">("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<null | "link" | "reset">(null);

  function siteOrigin() {
    return typeof window !== "undefined" ? window.location.origin : "";
  }

  function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          // Never create an account from this page — a portal login only
          // exists once an owner has invited that client.
          shouldCreateUser: false,
          emailRedirectTo: `${siteOrigin()}/auth/callback?next=/client`,
        },
      });
      // Deliberately not distinguishing "no such account" — that would let
      // anyone test whether an address is a client of this company.
      if (err && !/signups not allowed|not authorized/i.test(err.message)) {
        setError(err.message);
        return;
      }
      setSent("link");
    });
  }

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr) {
        setError(
          /invalid login credentials/i.test(signInErr.message)
            ? "That email and password don't match. Try the emailed sign-in link instead."
            : signInErr.message,
        );
        return;
      }
      router.push("/client");
      router.refresh();
    });
  }

  function sendReset() {
    setError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${siteOrigin()}/auth/callback?next=/client/reset` },
      );
      if (err) {
        setError(err.message);
        return;
      }
      setSent("reset");
    });
  }

  if (sent) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
        <p className="font-semibold">Check your email.</p>
        <p className="mt-1 text-[13px]">
          {sent === "link"
            ? `If ${email.trim()} has an account, a sign-in link is on its way. It expires in an hour.`
            : `If ${email.trim()} has an account, a link to set a new password is on its way.`}
        </p>
        <button
          type="button"
          className="mt-2 text-[13px] underline underline-offset-2"
          onClick={() => {
            setSent(null);
            setError(null);
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={mode === "link" ? sendMagicLink : signIn}
      className="space-y-3"
    >
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {mode === "password" && (
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending
          ? mode === "link"
            ? "Sending…"
            : "Signing in…"
          : mode === "link"
            ? "Email me a sign-in link"
            : "Sign in"}
      </Button>

      <div className="flex flex-col gap-1.5 pt-1 text-center text-[12px]">
        {mode === "link" ? (
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              setMode("password");
              setError(null);
            }}
          >
            I have a password
          </button>
        ) : (
          <>
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setMode("link");
                setError(null);
              }}
            >
              Email me a sign-in link instead
            </button>
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              onClick={sendReset}
              disabled={pending || !email.trim()}
            >
              Forgot your password?
            </button>
          </>
        )}
      </div>
    </form>
  );
}
