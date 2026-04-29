"use client";

import { useState, useTransition } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  bulkGenerateInvoicesAction,
  type BulkInvoiceResult,
} from "./actions";

/**
 * One-click "generate invoices for all completed jobs" button. Calls the
 * bulk action, shows an inline result message, and relies on the server
 * revalidation to refresh the invoice list without a full navigation.
 */
export function BulkInvoiceButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkInvoiceResult | null>(null);

  function run() {
    if (!confirm(
      "Generate draft invoices for every completed job that doesn't have one yet?\n\nThis runs all at once and can't be undone in bulk."
    )) return;

    startTransition(async () => {
      const r = await bulkGenerateInvoicesAction();
      setResult(r);
    });
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-xs text-muted-foreground">
          {result.created > 0
            ? `✓ ${result.created} invoice${result.created !== 1 ? "s" : ""} created`
            : result.skipped > 0
            ? "All completed jobs already invoiced."
            : "No eligible jobs found."}
          {result.errors.length > 0 && (
            <span className="ml-1 text-destructive">
              ({result.errors.length} error{result.errors.length !== 1 ? "s" : ""})
            </span>
          )}
        </span>
      )}
      <Button
        variant="outline"
        onClick={run}
        disabled={pending}
      >
        <Zap className="h-4 w-4" />
        {pending ? "Generating…" : "Batch invoice"}
      </Button>
    </div>
  );
}
