"use client";

import { useActionState } from "react";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import {
  syncInvoiceToSageAction,
  type SyncSageState,
} from "../actions";

const EMPTY: SyncSageState = {};

/**
 * Manual Sage sync button for the invoice detail page. The background
 * push runs automatically on send; this is the retry path for when
 * that didn't work (Sage briefly down, token expired mid-request, etc.).
 *
 * Renders inline success / error so the owner sees what happened
 * without digging through logs.
 */
export function SyncSageButton({
  invoiceId,
  alreadySynced,
}: {
  invoiceId: string;
  /** True when the invoice already has a sage_invoice_id — we still
   *  render the button so the owner can force a retry, but the label
   *  changes to reflect the synced state. */
  alreadySynced: boolean;
}) {
  const [state, action] = useActionState<SyncSageState, FormData>(
    syncInvoiceToSageAction,
    EMPTY,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={invoiceId} />
        <SubmitButton
          variant={alreadySynced ? "ghost" : "outline"}
          size="sm"
          pendingLabel="Syncing…"
        >
          {alreadySynced ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Synced to Sage
            </>
          ) : (
            <>
              <BookOpen className="h-4 w-4" />
              Sync to Sage
            </>
          )}
        </SubmitButton>
      </form>
      {state.error && <FormError message={state.error} />}
      {state.ok && state.sageInvoiceId && !alreadySynced && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Pushed to Sage (id: {state.sageInvoiceId}).
        </p>
      )}
    </div>
  );
}
