"use client";

import { useState, useTransition } from "react";
import { Gift, Loader2, Check, AlertCircle } from "lucide-react";
import { redeemPromoCodeAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const REASONS: Record<string, string> = {
  invalid: "That code doesn't exist or has been deactivated.",
  expired: "That code has expired.",
  exhausted: "That code has already been fully redeemed.",
  already_redeemed: "Your organization has already used this code.",
  already_overridden:
    "Your account already has a billing override — no code needed.",
  empty: "Enter a code first.",
};

export function RedeemForm() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | null
    | { ok: true; kind: "free_forever" | "comp" }
    | { ok: false; message: string }
  >(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await redeemPromoCodeAction(formData);
      if (r.ok) {
        setResult({ ok: true, kind: r.kind });
      } else {
        setResult({
          ok: false,
          message: REASONS[r.reason] ?? "Could not redeem that code.",
        });
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <Gift className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Promo code</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Got a code? Redeem it here to unlock your plan.
          </p>

          <form action={onSubmit} className="mt-4 flex gap-2">
            <Input
              name="code"
              placeholder="Enter promo code"
              className="max-w-xs font-mono uppercase"
              autoCapitalize="characters"
              disabled={isPending}
            />
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Redeeming…
                </>
              ) : (
                "Redeem"
              )}
            </Button>
          </form>

          {result?.ok && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {result.kind === "free_forever"
                  ? "Code redeemed — your account is now free, forever. No billing will ever be charged."
                  : "Code redeemed — your account has been comped."}
              </span>
            </div>
          )}
          {result && !result.ok && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{result.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
