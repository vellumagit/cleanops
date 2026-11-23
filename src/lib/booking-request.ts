import "server-only";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendOrgEmail, isClientEmailPaused, isEmailConfigured } from "@/lib/email";
import { detectCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";

/**
 * "I'd like a clean": one request, filed for the office to answer.
 *
 * Two doors lead here. A signed-in client asks from their client area
 * (app/client/(portal)/request), and a visitor asks from a company's booking
 * page (app/book/[slug]). Either way it is a row in booking_requests with
 * status pending, which the office reviews on /app/bookings/requests and
 * turns into a real booking once scope and price are agreed.
 *
 * Whoever calls this has already settled WHO is asking: the portal by the
 * session, the booking page by finding or making the person on the
 * company's books. This decides nothing about that.
 *
 * Written with the admin client: booking_requests has no client INSERT
 * policy by design.
 */
export type BookingRequestResult = { ok: true; requestId: string } | { ok: false; error: string };

const WINDOWS = ["morning", "afternoon", "evening", "flexible", ""];
const MAX_TEXT = 1000;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function fileBookingRequest(input: {
  organizationId: string;
  client: { id: string; name: string };
  serviceType: string;
  preferredDate: string;
  preferredTimeWindow: string;
  address: string;
  notes: string;
  /** Which door it came through, for the office's notice and email. */
  via: "client area" | "booking page";
}): Promise<BookingRequestResult> {
  const serviceType = input.serviceType.trim();
  const preferredDate = input.preferredDate.trim();
  const preferredTimeWindow = input.preferredTimeWindow.trim();
  const address = input.address.trim();
  const notes = input.notes.trim();

  if (!serviceType) return { ok: false, error: "Please describe what you need cleaned." };
  for (const [label, value] of [
    ["what you need cleaned", serviceType],
    ["address", address],
    ["notes", notes],
  ] as const) {
    if (value.length > MAX_TEXT) return { ok: false, error: `Keep the ${label} under ${MAX_TEXT} characters.` };
    // A card number typed into a free-text box must not land in the database.
    if (value && detectCardNumber(value)) return { ok: false, error: `${CARD_DETECTED_MESSAGE} (in ${label})` };
  }
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    return { ok: false, error: "Pick the date from the calendar, or leave it empty." };
  }
  if (!WINDOWS.includes(preferredTimeWindow)) {
    return { ok: false, error: "Pick a preferred time of day, or leave it flexible." };
  }

  const admin = createSupabaseAdminClient();
  const { data: inserted, error } = (await admin
    .from("booking_requests" as never)
    .insert({
      organization_id: input.organizationId,
      client_id: input.client.id,
      service_type: serviceType,
      preferred_date: preferredDate || null,
      preferred_time_window: preferredTimeWindow || null,
      address: address || null,
      notes: notes || null,
      status: "pending",
    } as never)
    .select("id")
    .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
  if (error || !inserted) {
    console.error("[booking-request] insert failed:", error?.message);
    return { ok: false, error: "Could not save your request. Try again in a moment." };
  }

  // In-app first: if mail is paused or lost, this is the trace.
  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: input.organizationId,
      audience: "org-management",
      topic: "clients",
      title: "New booking request",
      body: `${input.client.name} asked for ${serviceType}${preferredDate ? `, preferred ${preferredDate}` : ""}, from your ${input.via}. Review and schedule it.`,
      href: "/app/bookings/requests",
    });
  } catch (err) {
    console.error("[booking-request] notify failed:", err);
  }

  // And an email to the owner. Never blocks the person's request.
  if (isEmailConfigured() && !isClientEmailPaused()) {
    try {
      const { data: orgRow } = (await admin
        .from("organizations")
        .select("name, contact_email, sender_email")
        .eq("id", input.organizationId)
        .maybeSingle()) as unknown as {
        data: { name: string; contact_email: string | null; sender_email: string | null } | null;
      };
      // The owner's own sign-in address first: always current, even when
      // the company's contact email was never filled in.
      let ownerEmail: string | null = null;
      const { data: owner } = (await admin
        .from("memberships")
        .select("profile_id")
        .eq("organization_id", input.organizationId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle()) as unknown as { data: { profile_id: string } | null };
      if (owner?.profile_id) {
        const { data: ownerUser } = await admin.auth.admin.getUserById(owner.profile_id);
        ownerEmail = ownerUser.user?.email ?? null;
      }
      const notifyTo = ownerEmail ?? orgRow?.contact_email ?? orgRow?.sender_email;
      if (notifyTo) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
        const lines: Array<[string, string]> = [["Service", serviceType]];
        if (preferredDate) lines.push(["Preferred date", preferredDate]);
        if (preferredTimeWindow) lines.push(["Preferred time", preferredTimeWindow]);
        if (address) lines.push(["Address", address]);
        if (notes) lines.push(["Notes", notes]);
        const intro = `${input.client.name} just asked for a clean from your ${input.via}.`;
        sendOrgEmail(input.organizationId, {
          to: notifyTo,
          toName: orgRow?.name,
          subject: `New booking request from ${input.client.name}`,
          html: `<p>${escapeHtml(intro)}</p>
<ul>
${lines.map(([k, v]) => `  <li><strong>${k}:</strong> ${escapeHtml(v)}</li>`).join("\n")}
</ul>
<p><a href="${siteUrl}/app/bookings/requests">Review and respond</a></p>`,
          text: [intro, "", ...lines.map(([k, v]) => `${k}: ${v}`), "", `Review and respond: ${siteUrl}/app/bookings/requests`].join("\n"),
        }).catch((err) => console.error("[booking-request] owner email failed:", err));
      }
    } catch (err) {
      console.error("[booking-request] owner email failed:", err);
    }
  }

  revalidatePath("/client/request");
  revalidatePath("/app/bookings/requests");
  return { ok: true, requestId: inserted.id };
}
