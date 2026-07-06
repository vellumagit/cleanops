import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToMembership, sendPushToOrg } from "@/lib/push";

/**
 * The ONE way to send a notification (in-app row + web push).
 *
 * `audience` is mandatory and explicit, so management content can NEVER
 * accidentally reach cleaners — the whole class of "owner alert broadcast to
 * everyone" bug is impossible to write, because there is no way to call this
 * without naming who it's for.
 *
 * This is the only module permitted to write the `notifications` table or
 * import the push senders (enforced by ESLint). DB-trigger inserts (SQL) are
 * separately gated by the notifications.min_role RLS policy.
 *
 * Audience → recipients + min_role (the RLS floor for the null-recipient case):
 *   - membership      → that one person (recipient-scoped row)
 *   - org-admins      → every active owner/admin (recipient-scoped rows)
 *   - org-management  → every active owner/admin/manager (recipient-scoped rows)
 *   - org-wide        → a single null-recipient row readable by everyone
 *
 * Management audiences use recipient-scoped rows (each person gets their own
 * read state, and the RLS "recipient = me" branch keeps them private) — so they
 * are safe regardless of min_role. Only `org-wide` writes a null-recipient row.
 *
 * Best-effort: swallows errors so a notification failure never breaks the
 * primary action.
 */
type MembershipRole = "owner" | "admin" | "manager" | "employee";

type NotifyBase = {
  organizationId: string;
  title: string;
  body: string;
  href: string;
  /** Notification `type` (defaults to "general"). */
  type?: string;
  /** Channels — both on by default. */
  channels?: { inApp?: boolean; push?: boolean };
};

export type NotifyInput = NotifyBase &
  (
    | { audience: "membership"; membershipId: string }
    | { audience: "org-admins" }
    | { audience: "org-management" }
    | { audience: "org-wide" }
  );

type AdminDb = ReturnType<typeof createSupabaseAdminClient>;

async function membershipIdsForRoles(
  db: AdminDb,
  orgId: string,
  roles: MembershipRole[],
): Promise<string[]> {
  const { data } = (await db
    .from("memberships")
    .select("id")
    .eq("organization_id", orgId)
    .in("role", roles)
    .eq("status", "active")) as unknown as { data: Array<{ id: string }> | null };
  return (data ?? []).map((m) => m.id);
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    const type = input.type ?? "general";
    const doInApp = input.channels?.inApp ?? true;
    const doPush = input.channels?.push ?? true;
    const push = { title: input.title, body: input.body, href: input.href };

    // Resolve recipients (null => a single org-wide row) and the RLS floor.
    let recipientIds: string[] | null;
    let minRole: MembershipRole;
    switch (input.audience) {
      case "membership":
        recipientIds = [input.membershipId];
        minRole = "employee";
        break;
      case "org-admins":
        recipientIds = await membershipIdsForRoles(db, input.organizationId, [
          "owner",
          "admin",
        ]);
        minRole = "admin";
        break;
      case "org-management":
        recipientIds = await membershipIdsForRoles(db, input.organizationId, [
          "owner",
          "admin",
          "manager",
        ]);
        minRole = "manager";
        break;
      case "org-wide":
        recipientIds = null;
        minRole = "employee";
        break;
    }

    if (recipientIds === null) {
      if (doInApp) {
        await (db.from("notifications").insert({
          organization_id: input.organizationId,
          recipient_membership_id: null,
          type,
          title: input.title,
          body: input.body,
          href: input.href,
          min_role: minRole,
        } as never) as unknown as Promise<unknown>);
      }
      if (doPush) await sendPushToOrg(input.organizationId, push);
      return;
    }

    if (recipientIds.length === 0) return;

    if (doInApp) {
      await (db.from("notifications").insert(
        recipientIds.map((id) => ({
          organization_id: input.organizationId,
          recipient_membership_id: id,
          type,
          title: input.title,
          body: input.body,
          href: input.href,
          min_role: minRole,
        })) as never,
      ) as unknown as Promise<unknown>);
    }
    if (doPush) {
      await Promise.allSettled(
        recipientIds.map((id) => sendPushToMembership(id, push)),
      );
    }
  } catch (err) {
    console.error("[notify] failed:", err);
  }
}
