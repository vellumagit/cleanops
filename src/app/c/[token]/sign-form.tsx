"use client";

import { useActionState, useState } from "react";
import { PenLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { signContractAction, type SignContractState } from "./sign-actions";

const EMPTY: SignContractState = {};

export function SignForm({
  token,
  orgName,
  clientName,
}: {
  token: string;
  orgName: string;
  /** Pre-fills the name field — we already know who this contract
   *  is for; the signer can edit if the actual signer is different
   *  (e.g. signing on behalf of a company). */
  clientName: string;
}) {
  const [state, action] = useActionState<SignContractState, FormData>(
    signContractAction,
    EMPTY,
  );
  const [agreed, setAgreed] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <FormError message={state.error} />

      <FormField
        label="Full legal name"
        htmlFor="signer_name"
        required
        hint="Type your name as your signature. Required for the agreement to be legally binding."
      >
        <Input
          id="signer_name"
          name="signer_name"
          defaultValue={clientName}
          required
          autoComplete="name"
        />
      </FormField>

      <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm cursor-pointer hover:bg-muted/40 transition-colors">
        <input
          type="checkbox"
          name="agree"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I understand that by typing my name and clicking &ldquo;Sign
          contract&rdquo; below, I am signing this contract with{" "}
          <strong>{orgName}</strong> electronically, and that my typed name,
          the date, and my IP address will be recorded as evidence of the
          agreement. This has the same legal effect as a handwritten
          signature under the ESIGN Act and applicable provincial /
          state e-signature laws.
        </span>
      </label>

      <div className="flex items-center justify-end pt-2">
        <SubmitButton
          size="default"
          pendingLabel="Signing…"
        >
          <PenLine className="h-4 w-4" />
          Sign contract
        </SubmitButton>
      </div>
    </form>
  );
}
