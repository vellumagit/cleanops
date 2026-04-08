"use client";

import { SubmitButton } from "@/components/submit-button";
import { deletePackageAction } from "../../actions";

export function DeletePackageForm({ id }: { id: string }) {
  return (
    <form
      action={deletePackageAction}
      onSubmit={(e) => {
        if (!window.confirm("Delete this package? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="destructive" pendingLabel="Deleting…">
        Delete package
      </SubmitButton>
    </form>
  );
}
