import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * "Who is responsible for X in this org?" — with escalation.
 *
 * Sollos orgs are small and lopsided. A two-person cleaning company has an
 * owner and one cleaner and no manager at all; a bigger one has three
 * managers and an owner who never opens the app. Addressing a message to
 * "the manager" therefore has to mean "the manager, or whoever stands in for
 * one" — otherwise the smallest orgs silently receive nothing, which is the
 * worst possible failure for an alert.
 *
 * So: pick the most specific tier that actually has people in it, walking UP
 * the chain until someone is found.
 *
 *   manager → (no managers?) admin → (no admins?) owner
 *
 * Use this for TARGETED delivery — SMS, email, anything with a cost or a
 * limited audience. For in-app/push notifications prefer notify()'s
 * `org-management` audience, which deliberately broadcasts to everyone who
 * could act: an extra badge costs nothing, an unsent SMS costs a shift.
 */

export type OrgRole = "owner" | "admin" | "manager" | "employee";

/**
 * Escalation chains, most-specific first. Each entry lists the roles to try in
 * order; the first tier with at least one ACTIVE member wins outright (we do
 * not merge tiers — that would page the owner every time a manager exists).
 */
const ESCALATION: Record<Exclude<OrgRole, "employee">, OrgRole[]> = {
  manager: ["manager", "admin", "owner"],
  admin: ["admin", "owner"],
  owner: ["owner"],
};

export type ResponsibleMember = {
  membershipId: string;
  profileId: string | null;
  displayName: string | null;
  /** memberships.contact_phone when set, else the profile's phone. */
  phone: string | null;
  email: string | null;
  /** The role actually matched — "owner" here means the chain fell through. */
  matchedRole: OrgRole;
};

/**
 * Active members responsible for `role`, after escalation. Empty only when the
 * org has no active members at all.
 */
export async function resolveResponsibleMembers(
  organizationId: string,
  role: Exclude<OrgRole, "employee">,
): Promise<ResponsibleMember[]> {
  const db = createSupabaseAdminClient();
  for (const tier of ESCALATION[role]) {
    const { data } = (await db
      .from("memberships")
      .select(
        "id, profile_id, display_name, contact_phone, contact_email, profile:profiles ( full_name, phone )",
      )
      .eq("organization_id", organizationId)
      .eq("role", tier)
      .eq("status", "active")) as unknown as {
      data: Array<{
        id: string;
        profile_id: string | null;
        display_name: string | null;
        contact_phone: string | null;
        contact_email: string | null;
        profile: { full_name: string | null; phone: string | null } | null;
      }> | null;
    };
    if (data && data.length > 0) {
      return data.map((m) => ({
        membershipId: m.id,
        profileId: m.profile_id,
        displayName: m.display_name ?? m.profile?.full_name ?? null,
        phone: m.contact_phone?.trim() || m.profile?.phone?.trim() || null,
        email: m.contact_email?.trim() || null,
        matchedRole: tier,
      }));
    }
  }
  return [];
}

/**
 * Same chain, narrowed to members reachable by SMS. Returns [] when nobody
 * responsible has a phone number — callers should treat that as "fall back to
 * email/in-app", never as "nobody to tell".
 */
export async function resolveResponsiblePhones(
  organizationId: string,
  role: Exclude<OrgRole, "employee">,
): Promise<ResponsibleMember[]> {
  const members = await resolveResponsibleMembers(organizationId, role);
  return members.filter((m) => Boolean(m.phone));
}
