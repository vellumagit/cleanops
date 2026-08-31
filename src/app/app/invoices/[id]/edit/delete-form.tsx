"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteInvoiceAction } from "../../actions";

/**
 * Delete button for the invoice edit page.
 *
 * When the invoice carries net payments the button doesn't render at
 * all — the page explains WHY instead of offering a dead end (clicking
 * used to reach the server guard, which threw, which meant the Next
 * error page for the user and a Sentry alert for us). The server guard
 * remains as the backstop for races (a payment recorded after this
 * page loaded) and now comes back as a toast, not an explosion.
 */
export function DeleteInvoiceForm({
  id,
  paidLabel,
}: {
  id: string;
  /** Formatted net-payments amount when > 0, e.g. "CA$180.00". */
  paidLabel?: string | null;
}) {
  const [pending, startTransition] = useTransition();

  if (paidLabel) {
    return (
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          This invoice has <span className="font-medium">{paidLabel}</span> in
          recorded payments, so it can&apos;t be deleted — that money would
          vanish from the books. Refund or remove the payments from the
          invoice page first; then delete works.
        </span>
      </p>
    );
  }

  function onDelete() {
    if (
      !window.confirm(
        "Delete this invoice? Line items will be removed too. This cannot be undone.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      try {
        // Success redirects server-side; a guard outcome comes back as a
        // value instead of detonating the page.
        const res = await deleteInvoiceAction(fd);
        if (res && !res.ok) toast.error(res.error);
      } catch {
        toast.error("Delete failed — try again.");
      }
    });
  }

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={pending}
      onClick={onDelete}
    >
      {pending ? "Deleting…" : "Delete invoice"}
    </Button>
  );
}
