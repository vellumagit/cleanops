"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { signContractAction, type SignContractState } from "./sign-actions";
import { SignaturePad } from "./signature-pad";

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
  const router = useRouter();
  const [state, action] = useActionState<SignContractState, FormData>(
    signContractAction,
    EMPTY,
  );

  // Navigate to ?signed=1 after a successful submission so the URL
  // updates and a page refresh shows the thank-you card instead of
  // the sign form. router.replace keeps the browser history clean.
  useEffect(() => {
    if (state.ok) {
      router.replace(`/c/${token}?signed=1`);
    }
  }, [state.ok, token, router]);
  const [agreed, setAgreed] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState("");

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input
        type="hidden"
        name="signature_data_url"
        value={signatureDataUrl}
      />
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

      {/* Optional drawn signature. Typed name is the legal record;
          the drawing is a polish — it gives the client the visceral
          "I just signed" feeling and adds a second piece of evidence. */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Draw your signature{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <SignaturePad
          onChange={setSignatureDataUrl}
          ariaLabel="Draw your signature"
        />
      </div>

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
