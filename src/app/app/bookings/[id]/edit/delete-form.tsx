"use client";

import { SubmitButton } from "@/components/submit-button";
import { deleteBookingAction } from "../../actions";

export function DeleteBookingForm({ id }: { id: string }) {
  return (
    <form
      action={deleteBookingAction}
      onSubmit={(e) => {
        if (!window.confirm("Delete this booking? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete booking
      </SubmitButton>
    </form>
  );
}
