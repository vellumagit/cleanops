"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  authUserExistsForEmail,
  findClientByPortalToken,
  linkPortalAccount,
} from "@/lib/portal-claim";
import { logAuditEvent } from "@/lib/audit";
import { sendOrgEmail } from "@/lib/email";

type Result =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
      /** The refusal is "you already have an account" — the claim page turns
       *  this into a Sign in button rather than telling them to navigate. */
      signInInstead?: boolean;
      /** Where "sign in" should go — back to this claim link once signed in. */
      signInHref?: string;
    };

const INVITE_TTL_DAYS = 14;

/**
 * Admin-side action: send a client an invite to the self-serve portal.
 * Generates a URL-safe random token, hashes it for storage, and emails
 * the client a plaintext claim link. Link expires in 14 days.
 *
 * Idempotent — calling again replaces any existing unaccepted invite.
 */
export async function invitePortalAction(formData: FormData): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can invite clients." };
  }

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "Missing client id." };

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, organization_id, profile_id")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };
  if (client.organization_id !== membership.organization_id) {
    return { ok: false, error: "Client not in this org." };
  }
  if (client.profile_id) {
    return {
      ok: false,
      error: "Client already has portal access.",
    };
  }
  if (!client.email) {
    return {
      ok: false,
      error: "This client has no email on file. Add one first and try again.",
    };
  }

  // Random 32-byte token, base64url-safe. We store the SHA-256 hash so a
  // leaked DB doesn't expose usable invite links.
  const plainToken = randomBytes(32).toString("base64url");
  const hashed = createHash("sha256").update(plainToken).digest("hex");
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await supabase
    .from("clients")
    .update({
      portal_invite_token: hashed,
      portal_invite_expires_at: expiresAt,
      portal_invited_at: new Date().toISOString(),
      // Reset prior acceptance if the owner is re-inviting (shouldn't
      // happen given the profile_id guard above, but defensive).
      portal_accepted_at: null,
    } as never)
    .eq("id", clientId);

  if (error) return { ok: false, error: error.message };

  // Send the email (fire-and-forget; don't block the action on SMTP).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const claimUrl = `${siteUrl}/client/claim/${plainToken}`;

  // Owner-initiated portal invite — bypass the platform kill switch
  // (it's not an automated client email, it's a deliberate admin action).
  sendOrgEmail(membership.organization_id, {
    to: client.email,
    toName: client.name,
    pauseExempt: true,
    subject: `Access your ${membership.organization_name} account`,
    html: `
      <p>Hi ${escapeHtml(client.name)},</p>
      <p>${escapeHtml(membership.organization_name)} has invited you to their client portal. You can see your upcoming jobs, past service history, and outstanding invoices in one place.</p>
      <p><a href="${claimUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Set up your account</a></p>
      <p style="color:#666;font-size:13px;">Or paste this link into your browser: <br>${claimUrl}</p>
      <p style="color:#666;font-size:13px;">This link expires in ${INVITE_TTL_DAYS} days.</p>
    `,
    text: `Hi ${client.name},

${membership.organization_name} has invited you to their client portal.

Set up your account: ${claimUrl}

This link expires in ${INVITE_TTL_DAYS} days.`,
  });

  await logAuditEvent({
    membership,
    action: "invite",
    entity: "client",
    entity_id: client.id,
    after: { portal_invited: true, expires_at: expiresAt },
  });

  revalidatePath(`/app/clients/${clientId}/edit`);
  revalidatePath("/app/clients");
  return { ok: true };
}

/**
 * Public: the claim-page submit handler. Validates the token, creates
 * (or re-uses) an auth user with the supplied password, links the
 * client row, and burns the token.
 *
 * Lives in this file (not a route handler) so it can be invoked from
 * the claim page's server action.
 */
export async function acceptPortalInviteAction(
  token: string,
  password: string,
): Promise<Result> {
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const admin = createSupabaseAdminClient();
  const found = await findClientByPortalToken(admin, token);
  if (!found.ok) return { ok: false, error: found.error };
  const { client } = found;

  // An email match is NOT permission to set that account's password — and,
  // since 2026-09-13, not permission to adopt the account either. Anyone
  // can register any address against the auth project with the public key
  // before the invite goes out; linking "the" existing account from this
  // unauthenticated form handed the client's portal to whoever registered
  // first. If a login exists, its holder proves it by signing in, and the
  // claim page links a session whose email matches the invite.
  if (await authUserExistsForEmail(admin, client.email)) {
    return {
      ok: false,
      error:
        "There is already a Sollos login for this email. Sign in with it, and this link will connect it to your portal.",
      signInInstead: true,
      signInHref: `/client/login?next=${encodeURIComponent(`/client/claim/${token}`)}`,
    };
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: client.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: client.name, is_client: true },
  });
  if (createErr || !created.user) {
    console.error("[portal-claim] createUser failed:", createErr?.message);
    return { ok: false, error: "Could not create account. Try again, or ask for a new invite." };
  }

  const linked = await linkPortalAccount(admin, client, created.user.id);
  if (!linked.ok) return { ok: false, error: linked.error };
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
