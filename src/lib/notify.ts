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
  /**
   * Channels. inApp and push are on by default; email is OPT-IN.
   *
   * Email defaults off deliberately — turning it on globally would mail an
   * owner for every routine event. Switch it on for escalations that must
   * land even when nobody is looking at the app: a capped shift, an
   * unstaffed job, a failed invoice send.
   */
  channels?: { inApp?: boolean; push?: boolean; email?: boolean };
  /** Push behaviour. sticky = stays in the shade until dismissed (Android);
   *  quiet = updates without re-buzzing; tag = explicit collapse key so a
   *  repeating nudge rewrites itself instead of stacking. */
  push?: { sticky?: boolean; quiet?: boolean; tag?: string };
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


/**
 * Resolve a staff member's address. contact_email on the membership wins;
 * otherwise the identity they sign in with, which lives in auth.users rather
 * than public.profiles.
 */
async function staffEmail(
  db: AdminDb,
  membershipId: string,
): Promise<{ email: string; name: string } | null> {
  const { data } = (await db
    .from("memberships")
    .select("display_name, contact_email, profile:profiles ( id, full_name )")
    .eq("id", membershipId)
    .maybeSingle()) as unknown as {
    data: {
      display_name: string | null;
      contact_email: string | null;
      profile: { id: string; full_name: string | null } | null;
    } | null;
  };
  if (!data) return null;
  const name = data.display_name ?? data.profile?.full_name ?? "there";

  const direct = data.contact_email?.trim();
  if (direct) return { email: direct, name };

  const profileId = data.profile?.id;
  if (!profileId) return null;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${profileId}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { email?: string };
    return j.email ? { email: j.email, name } : null;
  } catch {
    return null;
  }
}

/**
 * Email the same content the in-app row carries.
 *
 * Exists because SMS was the only channel that ever left the building for
 * management escalations, and an owner with no phone (or a placeholder one)
 * got nothing at all when a shift was capped.
 */
async function emailRecipients(
  db: AdminDb,
  input: NotifyInput,
  recipientIds: string[],
  type: string,
): Promise<void> {
  const { sendOrgEmail } = await import("@/lib/email");
  const { renderStaffAlertEmail } = await import("@/lib/email-templates");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const url = input.href.startsWith("http") ? input.href : `${site}${input.href}`;

  for (const id of recipientIds) {
    const who = await staffEmail(db, id);
    if (!who) {
      console.error(`[notify] no email for membership ${id} (type="${type}")`);
      continue;
    }
    const { subject, html, text } = renderStaffAlertEmail({
      name: who.name,
      title: input.title,
      body: input.body,
      href: url,
    });
    await sendOrgEmail(input.organizationId, {
      to: who.email,
      toName: who.name,
      subject,
      html,
      text,
      // CLIENT_EMAILS_PAUSED exists to stop CLIENTS being mailed during
      // onboarding or testing. This is an internal alert to the org's own
      // staff, so that switch must not silence it — otherwise flipping it
      // would mute the escalation and nobody would know, which is precisely
      // the failure this whole email channel was added to fix.
      pauseExempt: true,
    });
  }
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    const type = input.type ?? "general";
    const doInApp = input.channels?.inApp ?? true;
    const doPush = input.channels?.push ?? true;
    const doEmail = input.channels?.email ?? false;
    const push = {
      title: input.title,
      body: input.body,
      href: input.href,
      sticky: input.push?.sticky,
      quiet: input.push?.quiet,
      tag: input.push?.tag,
    };

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
        const { error: insErr } = (await db.from("notifications").insert({
          organization_id: input.organizationId,
          recipient_membership_id: null,
          type,
          title: input.title,
          body: input.body,
          href: input.href,
          min_role: minRole,
        } as never)) as unknown as { error: { message: string } | null };
        if (insErr) {
          console.error(
            `[notify] in-app insert FAILED (type="${type}", audience=org-wide): ${insErr.message}`,
          );
        }
      }
      if (doPush) await sendPushToOrg(input.organizationId, push);
      return;
    }

    if (recipientIds.length === 0) return;

    if (doInApp) {
      // The result used to be discarded. notifications.type is an ENUM, and
      // seven of the eight types this app sends were never members of it —
      // so every insert failed 22P02 and nobody found out for weeks. Check
      // it, and shout, because a silent notification is worse than none.
      const { error: insErr } = (await db.from("notifications").insert(
        recipientIds.map((id) => ({
          organization_id: input.organizationId,
          recipient_membership_id: id,
          type,
          title: input.title,
          body: input.body,
          href: input.href,
          min_role: minRole,
        })) as never,
      )) as unknown as { error: { message: string } | null };
      if (insErr) {
        console.error(
          `[notify] in-app insert FAILED (type="${type}", audience=${input.audience}): ${insErr.message}`,
        );
      }
    }
    if (doPush) {
      await Promise.allSettled(
        recipientIds.map((id) => sendPushToMembership(id, push)),
      );
    }
    if (doEmail) await emailRecipients(db, input, recipientIds, type);
  } catch (err) {
    console.error("[notify] failed:", err);
  }
}
