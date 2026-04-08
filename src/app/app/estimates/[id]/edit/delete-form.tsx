"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteEstimateAction } from "../../actions";

export function DeleteEstimateForm({ id }: { id: string }) {
  return (
    <form
      action={deleteEstimateAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete this estimate? Line items will be removed too. This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete estimate
      </SubmitButton>
    </form>
  );
}
