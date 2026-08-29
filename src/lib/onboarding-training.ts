import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assign every `assign_on_join` training module to a membership — the
 * system doing the "assign the onboarding training" step of the hiring
 * procedure instead of someone's memory.
 *
 * Idempotent: unique(module_id, employee_id) + ignoreDuplicates means a
 * re-run (or a returning member being re-activated) never duplicates an
 * assignment or resets completed history. Best-effort by design — a
 * failure here must never break the join that triggered it.
 */
export async function assignOnboardingTraining(
  admin: SupabaseClient,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  try {
    const { data: modules } = (await admin
      .from("training_modules")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("assign_on_join" as never, true as never)
      .eq("status", "published")) as unknown as {
      data: Array<{ id: string }> | null;
    };
    if (!modules || modules.length === 0) return;

    const { error } = await admin.from("training_assignments").upsert(
      modules.map((m) => ({
        organization_id: organizationId,
        module_id: m.id,
        employee_id: membershipId,
      })),
      { onConflict: "module_id,employee_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("[onboarding-training] assign failed:", error.message);
    }
  } catch (err) {
    console.error("[onboarding-training] assign threw:", err);
  }
}
