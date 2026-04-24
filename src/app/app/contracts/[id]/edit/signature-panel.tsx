"use client";

import { useState, useActionState } from "react";
import {
  PenLine,
  Copy,
  CheckCircle2,
  ExternalLink,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import {
  sendContractForSignatureAction,
  type SendContractState,
} from "../../actions";

const EMPTY: SendContractState = {};

type Props = {
  contractId: string;
  /** Current signing state from the contract row. */
  initialToken: string | null;
  signStatus: "unsent" | "sent" | "signed" | "declined";
  signedAt: string | null;
  signerName: string | null;
  siteUrl: string;
};

/**
 * Admin-side e-sign control panel. Three visual states:
 *   - unsent → "Send for signature" button, no link yet
 *   - sent   → link displayed with copy button + resend button
 *   - signed → green "Signed by X on Y" summary + link still shown
 *              so the owner can re-share (clients sometimes ask for
 *              a receipt-like URL).
 */
export function SignaturePanel({
  contractId,
  initialToken,
  signStatus,
  signedAt,
  signerName,
  siteUrl,
}: Props) {
  const [state, action] = useActionState<SendContractState, FormData>(
    sendContractForSignatureAction,
    EMPTY,
  );
  const [copied, setCopied] = useState(false);

  // Prefer the freshly-minted url from the action, else compose one
  // from the server-rendered token.
  const signUrl =
    state.signUrl ??
    (initialToken ? `${siteUrl}/c/${initialToken}` : null);

  async function copyUrl() {
    if (!signUrl) return;
    try {
      await navigator.clipboard.writeText(signUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — fall back to selecting the text so the
      // user can manually copy.
      setCopied(false);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold">E-signature</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Send a secure signing link to the client. They&rsquo;ll type their
        name and click to sign — legally binding under ESIGN / UETA.
      </p>

      <div className="mt-4 space-y-3">
        {signStatus === "signed" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  Signed by {signerName ?? "the client"}
                </p>
                {signedAt && (
                  <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-400/80">
                    {new Date(signedAt).toLocaleString("en-US", {
                      dateStyle: "long",
                      timeStyle: "short",
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {signStatus === "sent" && !state.ok && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Signing link created. Waiting for the client to sign.
              </p>
            </div>
          </div>
        )}

        {signUrl && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Signing link
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-border bg-background px-2 py-1.5 text-xs">
                {signUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyUrl}
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
              <a
                href={signUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Paste this into an email or text to the client. Anyone with
              the link can view + sign, so only share with the intended
              signer.
            </p>
          </div>
        )}

        <FormError message={state.error} />

        <form action={action}>
          <input type="hidden" name="id" value={contractId} />
          <SubmitButton
            variant={signStatus === "unsent" ? "default" : "outline"}
            size="sm"
            pendingLabel={
              signStatus === "unsent" ? "Creating link…" : "Regenerating…"
            }
          >
            <PenLine className="h-4 w-4" />
            {signStatus === "unsent"
              ? "Send for signature"
              : signStatus === "signed"
                ? "Resend link"
                : "Regenerate link"}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
