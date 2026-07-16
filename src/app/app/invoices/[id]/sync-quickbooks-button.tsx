"use client";

import { useActionState } from "react";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import {
  syncInvoiceToQuickBooksAction,
  type SyncQuickBooksState,
} from "../actions";

const EMPTY: SyncQuickBooksState = {};

/**
 * Manual QuickBooks sync button for the invoice detail page. The background
 * push runs automatically on send; this is the retry path. Renders inline
 * success / error so the owner sees what happened without digging through logs.
 */
export function SyncQuickBooksButton({
  invoiceId,
  alreadySynced,
}: {
  invoiceId: string;
  alreadySynced: boolean;
}) {
  const [state, action] = useActionState<SyncQuickBooksState, FormData>(
    syncInvoiceToQuickBooksAction,
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
              Synced to QuickBooks
            </>
          ) : (
            <>
              <BookOpen className="h-4 w-4" />
              Sync to QuickBooks
            </>
          )}
        </SubmitButton>
      </form>
      {state.error && <FormError message={state.error} />}
      {state.ok && state.qbInvoiceId && !alreadySynced && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Pushed to QuickBooks (id: {state.qbInvoiceId}).
        </p>
      )}
    </div>
  );
}
