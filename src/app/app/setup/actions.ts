"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";

export async function completeOnboardingAction() {
  const { membership, supabase } = await getActionContext();

  // Only owners and admins can finalize onboarding.
  if (!["owner", "admin"].includes(membership.role)) {
    throw new Error("You don't have permission to complete onboarding.");
  }

  // Through the service key, after the role check above. The company row's
  // own rule lets only OWNERS update it, so an admin's press changed
  // nothing, was logged as done, and sent them on.
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const { data: finished, error } = await createSupabaseAdminClient()
    .from("organizations")
    .update({ onboarding_completed_at: new Date().toISOString() } as never)
    .eq("id", membership.organization_id)
    .select("id");

  if (error) throw error;
  if (!finished?.length) throw new Error("Setup couldn't be marked complete. Try again.");

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    after: { onboarding_completed: true },
  });

  revalidatePath("/app");
  redirect("/app");
}
