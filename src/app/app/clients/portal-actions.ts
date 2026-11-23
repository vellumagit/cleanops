"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { findClientByPortalToken } from "@/lib/portal-claim";
import { signInFromInvite } from "@/lib/client-sign-in";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { logAuditEvent } from "@/lib/audit";
import { sendOrgEmail } from "@/lib/email";

type Result =
  | {
      ok: true;
      /** The invite link, returned once so the office can copy it. Only the
       *  invite action sets it; it is stored scrambled and can't be read back. */
      claimUrl?: string;
    }
  | {
      ok: false;
      error: string;
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
    subject: `See your cleans with ${membership.organization_name}`,
    html: `
      <p style="font-size:16px;">Hi ${escapeHtml(client.name)},</p>
      <p style="font-size:16px;">${escapeHtml(membership.organization_name)} has set up a page for you. It shows your upcoming visits and your invoices, and lets you ask for a clean.</p>
      <p><a href="${claimUrl}" style="display:inline-block;padding:14px 28px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Open my cleans</a></p>
      <p style="color:#666;font-size:13px;">There is no password to set up. Or paste this link into your browser: <br>${claimUrl}</p>
      <p style="color:#666;font-size:13px;">This link works for ${INVITE_TTL_DAYS} days. After that, go to ${siteUrl}/client/login and type this email address.</p>
    `,
    text: `Hi ${client.name},

${membership.organization_name} has set up a page for you. It shows your upcoming visits and your invoices, and lets you ask for a clean.

Open it here (no password to set up): ${claimUrl}

This link works for ${INVITE_TTL_DAYS} days. After that, go to ${siteUrl}/client/login and type this email address.`,
  });

  await logAuditEvent({
    membership,
    action: "invite",
    entity: "client",
    entity_id: client.id,
    after: { portal_invited: true, expires_at: expiresAt },
  });

  revalidatePath(`/app/clients/${clientId}/edit`);
  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app/clients");
  return { ok: true, claimUrl };
}

/**
 * Public: the invite page's one button. The link in the email only opens the
 * page; this press signs the client in and connects their record
 * (lib/client-sign-in.ts signInFromInvite).
 *
 * Until 2026-11-22 this step asked the client to choose a password. Holding
 * the invite proves the same thing a sign-in link does, that they can read
 * the address it was sent to, so now it simply lets them in.
 */
export async function openPortalInviteAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  // Public and unauthenticated: a read that fails stops it, and is not
  // taken for "no such invite" or "nobody holds this login".
  enterFailClosed();
  const token = String(formData.get("token") ?? "");
  const admin = createSupabaseAdminClient();

  let result: Awaited<ReturnType<typeof signInFromInvite>>;
  try {
    const found = await findClientByPortalToken(admin, token);
    if (!found.ok) return { error: found.error };
    result = await signInFromInvite(found.client);
  } catch (err) {
    console.error("[portal-invite] could not sign the client in:", err);
    return { error: "That didn't work. Press the button again, or ask your cleaner to send a new invite." };
  }
  if (!result.ok) {
    return { error: "That didn't work. Press the button again, or ask your cleaner to send a new invite." };
  }
  redirect("/client");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
