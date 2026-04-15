"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { claimOfferAction, type ClaimResult } from "./actions";

const initial: ClaimResult | null = null;

/**
 * Thin client wrapper so we get a pending state on the claim button.
 * The form POSTs the token (already baked into a hidden input) and the
 * action returns a ClaimResult. On success, the server revalidates this
 * page and the parent server component re-renders into the "you got it"
 * state, so this form only has to surface failures inline.
 */
export function ClaimForm({ token }: { token: string }) {
  const [result, formAction] = useActionState(
    async (_prev: ClaimResult | null, formData: FormData) => {
      const t = String(formData.get("token") ?? "");
      return claimOfferAction(t);
    },
    initial,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />

      {result && !result.ok && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
        >
          {result.reason === "already_filled" &&
            "All positions have been filled. Sorry!"}
          {result.reason === "already_claimed" &&
            "You already claimed this shift!"}
          {result.reason === "expired" && "This offer has expired."}
          {result.reason === "cancelled" &&
            "This offer was cancelled by the company."}
          {result.reason === "invalid" && "This link isn't valid."}
          {result.reason === "error" &&
            (result.message ?? "Something went wrong. Try again.")}
        </div>
      )}

      <SubmitButton className="w-full" size="lg" pendingLabel="Claiming…">
        I can do this shift
      </SubmitButton>
    </form>
  );
}
