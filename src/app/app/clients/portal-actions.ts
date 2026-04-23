"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { sendOrgEmail } from "@/lib/email";

type Result = { ok: true } | { ok: false; error: string };

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
      error:
        "This client has no email on file. Add one first and try again.",
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
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const claimUrl = `${siteUrl}/client/claim/${plainToken}`;

  sendOrgEmail(membership.organization_id, {
    to: client.email,
    toName: client.name,
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
  if (!token || token.length < 16) {
    return { ok: false, error: "Invalid link." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const hashed = createHash("sha256").update(token).digest("hex");
  const admin = createSupabaseAdminClient();

  const { data: client } = await admin
    .from("clients")
    .select(
      "id, organization_id, name, email, portal_invite_expires_at, profile_id",
    )
    .eq("portal_invite_token", hashed as never)
    .maybeSingle();

  if (!client) return { ok: false, error: "Invalid or expired link." };
  if (
    !client.portal_invite_expires_at ||
    new Date(client.portal_invite_expires_at).getTime() < Date.now()
  ) {
    return {
      ok: false,
      error: "This invite has expired. Ask for a new one.",
    };
  }
  if (client.profile_id) {
    return {
      ok: false,
      error:
        "This invite has already been used. Log in with the email + password you set.",
    };
  }
  if (!client.email) {
    return {
      ok: false,
      error:
        "This client has no email on file. Ask the business to fix that.",
    };
  }

  // Look for an existing auth user with this email. If they exist (e.g.
  // the client is already a member of a different Sollos org), we link
  // their existing user to this client row. Otherwise create a new one.
  let userId: string | null = null;
  {
    const { data: existing } = await admin.auth.admin.listUsers({
      perPage: 1000,
    });
    const found = existing?.users.find(
      (u) => u.email?.toLowerCase() === client.email!.toLowerCase(),
    );
    if (found) {
      userId = found.id;
      // Reset their password to the one they just typed. Gives a single
      // canonical "you own this inbox" moment.
      await admin.auth.admin.updateUserById(found.id, { password });
    }
  }

  if (!userId) {
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email: client.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: client.name, is_client: true },
      });
    if (createErr || !created.user) {
      return {
        ok: false,
        error: createErr?.message ?? "Could not create account.",
      };
    }
    userId = created.user.id;
  }

  // Link the client row + burn the token.
  const { error: linkErr } = await admin
    .from("clients")
    .update({
      profile_id: userId,
      portal_invite_token: null,
      portal_invite_expires_at: null,
      portal_accepted_at: new Date().toISOString(),
    } as never)
    .eq("id", client.id);

  if (linkErr) return { ok: false, error: linkErr.message };

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
