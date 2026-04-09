"use client";

import { SubmitButton } from "@/components/submit-button";
import { cancelJobOfferAction } from "../../actions";

export function CancelOfferForm({ id }: { id: string }) {
  return (
    <form
      action={cancelJobOfferAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Cancel this offer? Freelancers who still have the link will see a cancelled state.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="outline" size="sm" pendingLabel="Cancelling…">
        Cancel offer
      </SubmitButton>
    </form>
  );
}
