"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OFFICE_TOPICS, isOfficeTopic, mutedTopicsPrefs } from "@/lib/notification-topics";

/**
 * Save which topics alert the person pressing Save: their own choices, and
 * nobody else's.
 *
 * - Office only (owner, admin, manager). Cleaners have no choices: what they
 *   are sent, they need.
 * - The form posts the topics that should ALERT, one `alert` value each;
 *   every other topic is muted. A topic the app doesn't know is ignored.
 * - Written with the admin client, pinned to the caller's own membership
 *   row, because a manager can't otherwise write to memberships at all.
 */

export type NotificationChoicesState = { ok?: boolean; error?: string };

export async function saveMyNotificationChoicesAction(
  _prev: NotificationChoicesState,
  formData: FormData,
): Promise<NotificationChoicesState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Notification choices are for the office." };
  }

  const alerting = new Set(formData.getAll("alert").map(String).filter(isOfficeTopic));
  const muted = OFFICE_TOPICS.map((t) => t.key).filter((k) => !alerting.has(k));

  const { data: saved, error } = (await createSupabaseAdminClient()
    .from("memberships")
    .update({ notification_prefs: mutedTopicsPrefs(muted) } as never)
    .eq("id", membership.id)
    .eq("organization_id", membership.organization_id)
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
  if (error) return { error: error.message };
  if (!saved?.length) return { error: "Your choices weren't saved. Reload the page and try again." };

  revalidatePath("/app/notifications/choices");
  return { ok: true };
}
