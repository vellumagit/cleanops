"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import {
  cancelOrgDeletion,
  scheduleOrgDeletion,
} from "@/lib/tenant-data";

export type ScheduleDeletionState = {
  ok?: boolean;
  error?: string;
};

export async function scheduleOrgDeletionAction(
  _prev: ScheduleDeletionState,
  formData: FormData,
): Promise<ScheduleDeletionState> {
  const membership = await requireMembership(["owner"]);

  // Require the user to type the exact org name as a sanity check — same
  // pattern as GitHub / Stripe destructive actions.
  const typed = String(formData.get("confirm_name") ?? "").trim();
  const expected = String(formData.get("expected_name") ?? "").trim();

  if (!typed || !expected || typed !== expected) {
    return {
      error: "Confirmation name didn't match. Deletion NOT scheduled.",
    };
  }

  await scheduleOrgDeletion(membership.organization_id);
  revalidatePath("/app/settings/data");
  return { ok: true };
}

export async function cancelOrgDeletionAction(): Promise<void> {
  const membership = await requireMembership(["owner"]);
  await cancelOrgDeletion(membership.organization_id);
  revalidatePath("/app/settings/data");
}
