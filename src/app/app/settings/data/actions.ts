"use server";

import { revalidatePath } from "next/cache";
import { requireActionMembership } from "@/lib/auth";
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
  const membership = await requireActionMembership(["owner"]);

  // Require the user to type the exact org name as a sanity check — same
  // pattern as GitHub / Stripe destructive actions.
  const typed = String(formData.get("confirm_name") ?? "").trim();
  // The name to match is the REAL name of the company about to be scheduled,
  // read here. It used to be a name the page sent along (expected_name): an
  // owner of two companies who had switched company in another tab typed the
  // first one's name, matched the first one's hidden field, and scheduled
  // the second.
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const { data: org } = (await createSupabaseAdminClient()
    .from("organizations")
    .select("name")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { name: string } | null };
  const expected = (org?.name ?? "").trim();

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
  const membership = await requireActionMembership(["owner"]);
  await cancelOrgDeletion(membership.organization_id);
  revalidatePath("/app/settings/data");
}
