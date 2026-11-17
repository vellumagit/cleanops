"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

/**
 * Read state lives in two places.
 *
 * A notice addressed to one person is read when its own read_at is set.
 *
 * A team notice (no recipient) is ONE row everyone sees, so its read_at
 * cannot say who read it: whoever read it first, or pressed "mark all read",
 * used to clear it for the whole company. Each person's read of a team
 * notice is a row in notification_reads instead, and the notice's own
 * read_at is no longer written. (Team notices marked read before
 * 2026-11-17 keep their read_at and stay read for everyone.)
 */

type Ctx = Awaited<ReturnType<typeof getActionContext>>;

/** Record that this person has read these team notices. */
async function recordTeamReads(
  supabase: Ctx["supabase"],
  membership: Ctx["membership"],
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  await (supabase
    .from("notification_reads" as never)
    .upsert(
      notificationIds.map((notification_id) => ({
        notification_id,
        membership_id: membership.id,
        organization_id: membership.organization_id,
      })) as never,
      { onConflict: "notification_id,membership_id", ignoreDuplicates: true },
    ) as unknown as Promise<unknown>);
}

/**
 * Mark a single notification as read, for the person who pressed it.
 */
export async function markNotificationReadAction(notificationId: string) {
  const { membership, supabase } = await getActionContext();

  // Read through the person's own access: a notice they cannot see is not found.
  const { data: notice } = (await supabase
    .from("notifications" as never)
    .select("id, recipient_membership_id")
    .eq("id", notificationId)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: { id: string; recipient_membership_id: string | null } | null;
  };
  if (!notice) return;

  if (notice.recipient_membership_id === membership.id) {
    await supabase
      .from("notifications" as never)
      .update({ read_at: new Date().toISOString() } as never)
      .eq("id", notificationId)
      .eq("recipient_membership_id" as never, membership.id as never);
  } else if (notice.recipient_membership_id === null) {
    await recordTeamReads(supabase, membership, [notice.id]);
  }

  revalidatePath("/app");
}

/**
 * Mark everything this person can see as read, for this person only.
 */
export async function markAllNotificationsReadAction() {
  const { membership, supabase } = await getActionContext();

  // Their own notices.
  await (supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("organization_id", membership.organization_id)
    .eq("recipient_membership_id", membership.id)
    .is("read_at", null) as unknown as Promise<unknown>);

  // Team notices they can see (the table's own rule applies min_role).
  const { data: team } = (await supabase
    .from("notifications" as never)
    .select("id")
    .eq("organization_id", membership.organization_id)
    .is("recipient_membership_id", null)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(500)) as unknown as { data: Array<{ id: string }> | null };
  await recordTeamReads(
    supabase,
    membership,
    (team ?? []).map((n) => n.id),
  );

  revalidatePath("/app");
}
