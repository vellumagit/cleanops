"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function MfaVerifyForm({
  factors,
  nextPath,
}: {
  /** Every verified TOTP factor on the account, sorted oldest-first
   *  (primary first, backups after). The form challenges the
   *  currently-selected factor; users with multiple devices can
   *  switch from a small picker shown below the code field. */
  factors: Array<{ id: string; friendlyName: string }>;
  nextPath: string;
}) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the picked factor in state so the user can switch devices
  // without leaving the page. Defaults to the first (primary) which
  // matches the previous always-pick-factor-0 behavior.
  const [selectedFactorId, setSelectedFactorId] = useState<string>(
    factors[0]?.id ?? "",
  );
  const selectedFactor =
    factors.find((f) => f.id === selectedFactorId) ?? factors[0];
  const factorId = selectedFactor?.id ?? "";
  const friendlyName = selectedFactor?.friendlyName ?? "Authenticator";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge!.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      toast.success("Welcome back.");
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That code didn't work. Try the most recent one from your app.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center">
        <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">Verify your sign-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the 6-digit code from{" "}
          <span className="font-medium text-foreground">{friendlyName}</span>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="totp-code" className="sr-only">
          One-time code
        </Label>
        <Input
          id="totp-code"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          placeholder="123456"
          className="text-center font-mono text-2xl tracking-widest"
        />
        {error && (
          <p className="text-center text-xs text-destructive">{error}</p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={pending || code.length !== 6 || !factorId}
      >
        {pending ? "Verifying…" : "Continue"}
      </Button>

      {/* Factor switcher — only shown when the account has more than
          one verified device. Lost-primary recovery: user picks the
          backup device and uses its code. Default selection is the
          oldest (primary) factor so existing single-factor users see
          identical behavior. */}
      {factors.length > 1 && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Using a different device?
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {factors.map((f) => {
              const isSelected = f.id === selectedFactorId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setSelectedFactorId(f.id);
                    setCode("");
                    setError(null);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  disabled={pending}
                >
                  {f.friendlyName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={handleSignOut}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Sign in as someone else
        </button>
      </div>
    </form>
  );
}
