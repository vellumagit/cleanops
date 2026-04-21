"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidIanaTz } from "@/lib/org-timezone";

export type TimezoneState = {
  ok?: boolean;
  error?: string;
};

export async function updateOrgTimezoneAction(
  _prev: TimezoneState,
  formData: FormData,
): Promise<TimezoneState> {
  const membership = await requireMembership(["owner", "admin"]);

  const tz = String(formData.get("timezone") ?? "").trim();
  if (!tz) {
    return { error: "Pick a timezone." };
  }
  if (!isValidIanaTz(tz)) {
    return {
      error: `"${tz}" isn't a recognized IANA timezone. Pick from the list.`,
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ timezone: tz } as never)
    .eq("id", membership.organization_id);

  if (error) return { error: error.message };

  revalidatePath("/app/settings/timezone");
  return { ok: true };
}
