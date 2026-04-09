"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteFreelancerContactAction } from "../../actions";

export function DeleteFreelancerForm({ id }: { id: string }) {
  return (
    <form
      action={deleteFreelancerContactAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Remove this freelancer from the bench? Their offer history is preserved.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Removing…">
        Remove from bench
      </SubmitButton>
    </form>
  );
}
