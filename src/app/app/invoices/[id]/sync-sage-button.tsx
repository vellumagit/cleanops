"use client";

import { useActionState } from "react";
import { BookOpen, CheckCircle2, ExternalLink } from "lucide-react";
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
  viewUrl = null,
}: {
  invoiceId: string;
  /** Sage's web page for the synced invoice, when Sage reported one. */
  viewUrl?: string | null;
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
      {alreadySynced && viewUrl && (
        <a
          href={viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          View in Sage
        </a>
      )}
      {state.error && <FormError message={state.error} />}
      {state.ok && state.sageInvoiceId && !alreadySynced && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Pushed to Sage (id: {state.sageInvoiceId}).
        </p>
      )}
    </div>
  );
}
