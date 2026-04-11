"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

/**
 * Mark a single notification as read.
 */
export async function markNotificationReadAction(notificationId: string) {
  const { supabase } = await getActionContext();

  await supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", notificationId);

  revalidatePath("/app");
}

/**
 * Mark all unread notifications as read for the current user's org.
 */
export async function markAllNotificationsReadAction() {
  const { membership, supabase } = await getActionContext();

  // Mark org-wide (null recipient) and personally-targeted notifications
  await supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("organization_id", membership.organization_id)
    .is("read_at", null);

  revalidatePath("/app");
}
