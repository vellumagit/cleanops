"use server";

import { getActionContext } from "@/lib/actions";
import { sendEmail } from "@/lib/email";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * "Request an integration / webhook help" form on Settings → Integrations.
 * Emails support@sollos3.com with the message, the requesting org, and the
 * sender's email as Reply-To so support can respond directly. Uses sendEmail
 * (internal/platform path) so it's unaffected by the client-email kill switch.
 */
export async function requestIntegrationAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { ok: false, error: "Please add a short message first." };
  if (message.length > 2000) {
    return { ok: false, error: "That's a bit long — please keep it under 2000 characters." };
  }

  const { membership, supabase } = await getActionContext();

  const [{ data: org }, { data: userData }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", membership.organization_id)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  const orgName = (org as { name?: string } | null)?.name ?? "Unknown org";
  const requesterEmail = userData?.user?.email ?? "unknown";

  const ok = await sendEmail({
    to: "support@sollos3.com",
    subject: `Integration request — ${orgName}`,
    replyTo: requesterEmail !== "unknown" ? requesterEmail : undefined,
    text: `Org: ${orgName}\nFrom: ${requesterEmail}\n\n${message}`,
    html:
      `<p><strong>Org:</strong> ${escapeHtml(orgName)}<br/>` +
      `<strong>From:</strong> ${escapeHtml(requesterEmail)}</p>` +
      `<p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
  });

  if (!ok) {
    return { ok: false, error: "Couldn't send right now — please try again." };
  }
  return { ok: true };
}
