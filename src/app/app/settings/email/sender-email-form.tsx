"use client";

import { useActionState } from "react";
import { CheckCircle2, Clock, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { saveSenderEmailAction, type SenderEmailFormState } from "./actions";

const empty: SenderEmailFormState = {};

export function SenderEmailForm({
  currentEmail,
  isVerified,
}: {
  currentEmail: string | null;
  isVerified: boolean;
}) {
  const [state, formAction] = useActionState(saveSenderEmailAction, empty);

  return (
    <form action={formAction} className="space-y-5 max-w-lg">
      <FormError message={state.errors?._form} />

      {state.success && !currentEmail && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Sender email cleared. Emails will come from noreply@sollos3.com.
        </div>
      )}

      {state.success && currentEmail && !isVerified && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          <Mail className="h-3.5 w-3.5" />
          Verification email sent to <strong>{currentEmail}</strong>. Check
          your inbox and click the link.
        </div>
      )}

      {currentEmail && isVerified && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>
            Verified — emails will be sent from{" "}
            <strong>{currentEmail}</strong>.
          </span>
        </div>
      )}

      {currentEmail && !isVerified && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          <Clock className="h-3.5 w-3.5" />
          <span>
            <strong>{currentEmail}</strong> — awaiting verification. Check your
            inbox. Until verified, emails come from noreply@sollos3.com.
          </span>
        </div>
      )}

      <FormField
        label="Sender email"
        htmlFor="sender_email"
        error={state.errors?.sender_email}
        hint="Invoices, booking confirmations, and review requests will come from this address. Must be a business domain (not Gmail/Yahoo)."
      >
        <Input
          id="sender_email"
          name="sender_email"
          type="email"
          placeholder="invoices@your-company.com"
          defaultValue={currentEmail ?? ""}
        />
      </FormField>

      <p className="text-xs text-muted-foreground">
        Leave blank to use the default (<code>noreply@sollos3.com</code>). A
        verification email will be sent to the address you enter.
      </p>

      <div className="flex items-center justify-end">
        <SubmitButton pendingLabel="Saving…">
          {currentEmail ? "Update & re-verify" : "Save & verify"}
        </SubmitButton>
      </div>
    </form>
  );
}
