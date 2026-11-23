"use server";

import { headers } from "next/headers";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkEmailRateLimit, checkIpRateLimit, getIp } from "@/lib/rate-limit-helpers";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { normalizePhone } from "@/lib/phone";
import { sendOrgEmail } from "@/lib/email";
import { publicBookingPage } from "@/lib/booking-page";
import { fileBookingRequest } from "@/lib/booking-request";

/**
 * "Ask for a clean" on a company's booking page, sent by someone who is
 * not signed in and may never have dealt with the company before.
 *
 * It ends as one row in the office's requests inbox, the same place a
 * signed-in client's request lands (lib/booking-request.ts). The person is
 * found on the company's books by email, or added as a lead, the way a
 * website inquiry is.
 *
 * A form with no sign-in that writes to a real inbox will be abused, so in
 * order: a hidden field only a script fills, limits per connection and per
 * email, the human check when it is configured, and the same new-contact
 * limits every other public form goes through.
 *
 * It tells a visitor nothing about anyone: an email that is already a
 * client's gets the same "we got it" as a new one.
 */
export type AskState = { ok?: boolean; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function askForCleanAction(_prev: AskState, formData: FormData): Promise<AskState> {
  // A read that fails stops here; it is not taken for "no such page".
  enterFailClosed();

  // A field no person sees. Filled in means a script: say thanks, do nothing.
  if (String(formData.get("website") ?? "").trim()) return { ok: true };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  if (!name) return { error: "Tell us your name." };
  if (name.length > 200) return { error: "That name is too long." };
  if (!email || !EMAIL.test(email) || email.length > 254) {
    return { error: "We need an email address to reply to you. Check it and try again." };
  }
  if (phoneRaw.length > 40) return { error: "That phone number is too long." };

  const byIp = await checkIpRateLimit("book-ask", 6, 60 * 60_000);
  const byEmail = await checkEmailRateLimit("book-ask", email, 3, 60 * 60_000);
  if (!byIp.allowed || !byEmail.allowed) {
    return { error: "You've sent a few requests already. We have them, and someone will be in touch. To add something, call us." };
  }

  const found = await publicBookingPage(String(formData.get("slug") ?? ""));
  if (!found) return { error: "This page isn't available any more." };
  // A draft opens for the company's own office, as a preview. It takes no
  // requests: nothing real should come out of a page nobody has published.
  if (found.preview) {
    return { error: "This is a preview, so the form is switched off. Publish your page and it will take requests." };
  }

  const ip = getIp(await headers());
  if (!(await verifyTurnstile(String(formData.get(TURNSTILE_FIELD) ?? "") || null, ip))) {
    return { error: "We couldn't confirm you're a person. Tick the check above the button and try again." };
  }

  // What they want: one of the services on the page, or their own words.
  const serviceId = String(formData.get("service_id") ?? "");
  const own = String(formData.get("service_other") ?? "").trim();
  const picked = found.services.find((s) => s.id === serviceId);
  const serviceType = picked ? (own ? `${picked.name}: ${own}` : picked.name) : own;
  if (!serviceType) return { error: "Tell us what you'd like cleaned." };

  const orgId = found.page.organization_id;
  const address = String(formData.get("address") ?? "").trim();
  const admin = createSupabaseAdminClient();
  // Found by email, or added as a lead. The new-contact limits and the
  // throwaway-address check are inside.
  const clientId = await findOrCreateClient(
    admin,
    orgId,
    { name, email, ...(phoneRaw ? { phone: normalizePhone(phoneRaw) } : {}), ...(address ? { address } : {}) },
    { createAs: "lead", leadSource: "web_form" },
  );
  if (!clientId) {
    return { error: "We couldn't take your request with that email address. Try another, or call us." };
  }

  const res = await fileBookingRequest({
    organizationId: orgId,
    // The name they typed today, for the office's notice. The record on the
    // books keeps the name it already had.
    client: { id: clientId, name },
    serviceType,
    preferredDate: String(formData.get("preferred_date") ?? ""),
    preferredTimeWindow: String(formData.get("preferred_time_window") ?? ""),
    address,
    notes: String(formData.get("notes") ?? ""),
    via: "booking page",
  });
  if (!res.ok) return { error: res.error };

  // So they know it arrived, and from whom the reply will come. They asked
  // for this, so the platform's "pause client emails" switch doesn't apply.
  const first = name.split(/\s+/)[0];
  const company = found.company.name;
  sendOrgEmail(orgId, {
    to: email,
    toName: name,
    pauseExempt: true,
    subject: `${company} got your request`,
    html: `<p style="font-size:16px;">Hi ${escapeHtml(first)},</p>
<p style="font-size:16px;">${escapeHtml(company)} has your request for <strong>${escapeHtml(serviceType)}</strong>. Someone will be in touch to confirm a time and a price.</p>
<p style="color:#666;font-size:13px;">Nothing is booked yet. If you didn't ask for this, you can ignore this message.</p>`,
    text: `Hi ${first},\n\n${company} has your request for ${serviceType}. Someone will be in touch to confirm a time and a price.\n\nNothing is booked yet. If you didn't ask for this, you can ignore this message.`,
  }).catch((err) => console.error("[book] confirmation email failed:", err));

  return { ok: true };
}
