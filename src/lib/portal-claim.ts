import "server-only";

import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The client-portal invite, resolved and linked in one place.
 *
 * Two callers: the public claim form (a stranger holding the emailed link
 * sets a password → a new auth user) and the claim page itself when a
 * session already exists (the invitee signed into the login they already
 * had → that user). Neither adopts an existing account from an
 * unauthenticated request: since 2026-09-13 an existing login is linked
 * only by a session whose email matches the invite.
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type PortalInviteClient = {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  profile_id: string | null;
};

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function findClientByPortalToken(
  admin: Admin,
  token: string,
): Promise<{ ok: true; client: PortalInviteClient } | { ok: false; error: string }> {
  if (!token || token.length < 16) return { ok: false, error: "Invalid link." };

  const { data: client } = await admin
    .from("clients")
    .select("id, organization_id, name, email, portal_invite_expires_at, profile_id")
    .eq("portal_invite_token", hashPortalToken(token) as never)
    .maybeSingle();

  if (!client) return { ok: false, error: "Invalid or expired link." };
  if (
    !client.portal_invite_expires_at ||
    new Date(client.portal_invite_expires_at).getTime() < Date.now()
  ) {
    return { ok: false, error: "This invite has expired. Ask for a new one." };
  }
  if (client.profile_id) {
    return {
      ok: false,
      error: "This invite has already been used. Log in with the email + password you set.",
    };
  }
  if (!client.email) {
    return {
      ok: false,
      error: "This client has no email on file. Ask the business to fix that.",
    };
  }
  return {
    ok: true,
    client: {
      id: client.id,
      organization_id: client.organization_id,
      name: client.name,
      email: client.email,
      profile_id: client.profile_id,
    },
  };
}

/** Whether any auth user in the project carries this email (any org, staff or client). */
export async function authUserExistsForEmail(admin: Admin, email: string): Promise<boolean> {
  const target = email.toLowerCase();
  let page = 1;
  for (;;) {
    const { data: batch } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (!batch?.users?.length) return false;
    if (batch.users.some((u) => u.email?.toLowerCase() === target)) return true;
    if (batch.users.length < 1000) return false;
    page++;
  }
}

/** Point the client row at this auth user and burn the invite token. */
export async function linkPortalAccount(
  admin: Admin,
  client: PortalInviteClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The only genuine conflict: a login ALREADY tied to a different client
  // row, which would silently move their portal from one client to another.
  const { data: otherClient } = await admin
    .from("clients")
    .select("id, name")
    .eq("profile_id", userId)
    .neq("id", client.id)
    .limit(1);
  if (otherClient && otherClient.length > 0) {
    return {
      ok: false,
      error: `That login is already the portal for ${otherClient[0].name}. One login can't cover two client accounts — ask for the invite to go to a different address.`,
    };
  }

  const { error } = await admin
    .from("clients")
    .update({
      profile_id: userId,
      portal_invite_token: null,
      portal_invite_expires_at: null,
      portal_accepted_at: new Date().toISOString(),
    } as never)
    .eq("id", client.id)
    .is("profile_id", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
