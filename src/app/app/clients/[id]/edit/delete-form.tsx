"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteClientAction } from "../../actions";

/**
 * Delete is a separate <form> rather than a button inside the edit form,
 * so its server action only fires on intentional submission. We use
 * window.confirm to gate the destructive click.
 */
export function DeleteClientForm({ id }: { id: string }) {
  return (
    <form
      action={deleteClientAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete this client? This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete client
      </SubmitButton>
    </form>
  );
}
