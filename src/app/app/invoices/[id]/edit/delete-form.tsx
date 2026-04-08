"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteInvoiceAction } from "../../actions";

export function DeleteInvoiceForm({ id }: { id: string }) {
  return (
    <form
      action={deleteInvoiceAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete this invoice? Line items will be removed too. This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete invoice
      </SubmitButton>
    </form>
  );
}
