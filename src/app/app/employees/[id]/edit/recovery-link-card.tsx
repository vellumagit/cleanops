"use client";

import { useState, useTransition } from "react";
import { Copy, Check, KeyRound, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  generateRecoveryLinkAction,
  type GenerateRecoveryLinkResult,
} from "../../actions";

/**
 * Owner/admin emergency tool: mint a single-use password recovery link
 * for this member and display it for copy-paste hand-off (text, DM,
 * etc). Created after we got rate-limited by Supabase's reset-email
 * cap on 2026-06-01 and had to fall back to curl. This card replaces
 * the curl workflow.
 *
 * Hidden for shadow employees (no auth account) — the parent page
 * passes `isShadow` and just doesn't render this card in that case.
 */
export function RecoveryLinkCard({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GenerateRecoveryLinkResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      const res = await generateRecoveryLinkAction(memberId);
      setResult(res);
      if (!res.ok) {
        toast.error(res.error);
      }
    });
  };

  const handleCopy = async () => {
    if (!result?.ok) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      toast.success("Recovery link copied. Send it to the employee directly.");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Couldn't copy to clipboard — select the text and copy manually.");
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/40">
          <KeyRound className="h-4 w-4 text-amber-700 dark:text-amber-300" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            Generate password reset link
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            For when {memberName} can&apos;t reset their own password (email
            not arriving, hit a rate limit, etc). Mints a single-use link
            you hand-deliver — text, DM, in person. Bypasses our email
            system entirely.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            Anyone who has this link can set a new password on this account.
            Send it directly to the employee on a channel only they control.
            This action is recorded in your audit log.
          </p>

          {!result?.ok && (
            <div className="mt-4">
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={pending}
                size="sm"
                variant="outline"
              >
                {pending ? "Generating…" : "Generate recovery link"}
              </Button>
            </div>
          )}

          {result?.ok && (
            <div className="mt-4 space-y-2">
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Recovery link for {result.email}
                </p>
                <p className="mt-1.5 break-all font-mono text-xs text-foreground">
                  {result.url}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={handleCopy}
                  size="sm"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy link
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={pending}
                  size="sm"
                  variant="outline"
                >
                  {pending ? "Generating…" : "Generate another"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Expires in ~{result.expires_in_minutes} minutes. Single-use —
                once they click it, it&apos;s spent.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
