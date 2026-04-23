"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { saveContactInfoAction, type ContactInfoFormState } from "./actions";

const empty: ContactInfoFormState = {};

/**
 * Form for the contact email + phone clients see on invoices. Separate
 * from sender_email because these are for the *client* to reach the
 * business, not for the From header of outgoing mail.
 */
export function ContactInfoForm({
  currentEmail,
  currentPhone,
}: {
  currentEmail: string | null;
  currentPhone: string | null;
}) {
  const [state, formAction] = useActionState(saveContactInfoAction, empty);

  return (
    <form action={formAction} className="space-y-5 max-w-lg">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Contact info saved. This appears on invoices and public invoice
          pages.
        </div>
      )}

      <FormField
        label="Contact email"
        htmlFor="contact_email"
        error={state.errors?.contact_email}
        hint="Shown on invoices so clients know where to send questions. Also used as the Reply-To on outgoing emails. Gmail / Outlook / any address is fine."
      >
        <Input
          id="contact_email"
          name="contact_email"
          type="email"
          placeholder="you@your-business.com"
          defaultValue={currentEmail ?? ""}
        />
      </FormField>

      <FormField
        label="Contact phone"
        htmlFor="contact_phone"
        error={state.errors?.contact_phone}
        hint="Shown on invoices alongside the contact email. Format however you like — (555) 123-4567, +1 555 123 4567, etc."
      >
        <Input
          id="contact_phone"
          name="contact_phone"
          type="tel"
          placeholder="(555) 123-4567"
          defaultValue={currentPhone ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end">
        <SubmitButton pendingLabel="Saving…">Save contact info</SubmitButton>
      </div>
    </form>
  );
}
