"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";

export async function completeOnboardingAction() {
  const { membership, supabase } = await getActionContext();

  // Only the owner finalizes onboarding. RLS would block non-owners at
  // the DB layer, but surface a clean error first.
  if (membership.role !== "owner") {
    throw new Error("Only the organization owner can complete onboarding.");
  }

  const { error } = await supabase
    .from("organizations")
    .update({ onboarding_completed_at: new Date().toISOString() } as never)
    .eq("id", membership.organization_id);

  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    after: { onboarding_completed: true },
  });

  revalidatePath("/app");
  redirect("/app");
}
