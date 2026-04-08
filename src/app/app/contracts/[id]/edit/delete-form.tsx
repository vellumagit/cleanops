"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteContractAction } from "../../actions";

export function DeleteContractForm({ id }: { id: string }) {
  return (
    <form
      action={deleteContractAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete this contract? This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete contract
      </SubmitButton>
    </form>
  );
}
