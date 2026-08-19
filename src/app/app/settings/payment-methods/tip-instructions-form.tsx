"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { FormError, FormField } from "@/components/form-field";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { MAX_TIP_INSTRUCTIONS } from "@/lib/tip-split";
import {
  saveTipInstructionsAction,
  type TipInstructionsState,
} from "./actions";

const empty: TipInstructionsState = {};

const SUGGESTION =
  "Tips are welcome and go straight to your cleaner — just add it to your e-transfer and we'll pass it on.";

/**
 * Public tipping wording, for clients who don't pay by card.
 *
 * The card path can offer buttons because there's a checkout to attach them
 * to. A bank transfer has nothing to attach to, so the only lever is saying so
 * — which matters more than it sounds, because that's how almost every payment
 * here actually arrives.
 */
export function TipInstructionsForm({
  defaultInstructions,
  tippingEnabled,
}: {
  defaultInstructions: string;
  tippingEnabled: boolean;
}) {
  const [state, formAction] = useActionState(saveTipInstructionsAction, empty);
  const [text, setText] = useState(defaultInstructions);

  // Re-seed when the saved value changes, so the box doesn't snap back to its
  // first-mount value after useActionState re-renders — the same fix the
  // auto-send form needed.
  const [seen, setSeen] = useState(defaultInstructions);
  if (defaultInstructions !== seen) {
    setSeen(defaultInstructions);
    setText(defaultInstructions);
  }

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          Saved.
        </div>
      )}

      {!tippingEnabled && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Tipping is currently off, so this text won&rsquo;t appear on any
          invoice. Turn it on under{" "}
          <Link
            href="/app/settings/invoicing"
            className="font-medium underline underline-offset-2"
          >
            Settings › Invoicing › Tips
          </Link>
          .
        </div>
      )}

      <FormField
        label="Tipping note"
        htmlFor="tip_instructions"
        error={state.errors?.instructions}
      >
        <Textarea
          id="tip_instructions"
          name="instructions"
          rows={3}
          maxLength={MAX_TIP_INSTRUCTIONS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={SUGGESTION}
        />
      </FormField>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setText(SUGGESTION)}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Use suggested wording
        </button>
        <span className="text-[11px] text-muted-foreground">
          {text.length}/{MAX_TIP_INSTRUCTIONS}
        </span>
      </div>

      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}
