"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

/**
 * Mark a single notification as read.
 */
export async function markNotificationReadAction(notificationId: string) {
  const { membership, supabase } = await getActionContext();

  await supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", notificationId)
    .eq("organization_id" as never, membership.organization_id as never);

  revalidatePath("/app");
}

/**
 * Mark all unread notifications as read for the current user.
 * Scoped to notifications the user can actually see: org-wide (null recipient)
 * and personally-targeted ones. Prevents stomping other members' unread state.
 */
export async function markAllNotificationsReadAction() {
  const { membership, supabase } = await getActionContext();

  await (supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("organization_id", membership.organization_id)
    .or(
      `recipient_membership_id.is.null,recipient_membership_id.eq.${membership.id}`,
    )
    .is("read_at", null) as unknown as Promise<unknown>);

  revalidatePath("/app");
}
