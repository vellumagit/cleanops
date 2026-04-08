"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteInventoryAction } from "../../actions";

export function DeleteInventoryForm({ id }: { id: string }) {
  return (
    <form
      action={deleteInventoryAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete this inventory item? This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete item
      </SubmitButton>
    </form>
  );
}
