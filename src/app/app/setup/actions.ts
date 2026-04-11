"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";

export async function completeOnboardingAction() {
  const { membership, supabase } = await getActionContext();

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
