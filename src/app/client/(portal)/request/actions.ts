"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendOrgEmail, isClientEmailPaused, isEmailConfigured } from "@/lib/email";

export type RequestBookingState = {
  error?: string;
  ok?: boolean;
  requestId?: string;
};

/**
 * Client submits a booking request from /client/request. Stored in
 * booking_requests with status=pending. The owner reviews it in
 * /app/bookings/requests and converts it to a real booking after
 * discussing scope / pricing with the client.
 *
 * Uses the admin client for the insert — we validate the client in
 * requireClient() first, and the schema has no client-side RLS INSERT
 * policy by design (the portal writes through server actions only).
 */
export async function submitBookingRequestAction(
  _prev: RequestBookingState,
  formData: FormData,
): Promise<RequestBookingState> {
  const client = await requireClient();

  const serviceType = String(formData.get("service_type") ?? "").trim();
  const preferredDate = String(formData.get("preferred_date") ?? "").trim();
  const preferredTimeWindow = String(
    formData.get("preferred_time_window") ?? "",
  ).trim();
  const address = String(formData.get("address") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!serviceType) {
    return { error: "Please describe what you need cleaned." };
  }

  // Time window is constrained on the DB side, but validate here too
  // so we return a helpful message instead of a constraint error.
  const validWindows = ["morning", "afternoon", "evening", "flexible", ""];
  if (!validWindows.includes(preferredTimeWindow)) {
    return {
      error: "Pick a preferred time window or leave it flexible.",
    };
  }

  const admin = createSupabaseAdminClient();

  const { data: inserted, error } = (await admin
    .from("booking_requests" as never)
    .insert({
      organization_id: client.organization_id,
      client_id: client.id,
      service_type: serviceType || null,
      preferred_date: preferredDate || null,
      preferred_time_window: preferredTimeWindow || null,
      address: address || null,
      notes: notes || null,
      status: "pending",
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error || !inserted) {
    console.error("[booking-request] insert failed:", error?.message);
    return {
      error: "Could not save your request. Try again in a moment.",
    };
  }

  // Notify the org that a request came in. Use the org's contact
  // email if set, otherwise the sender_email, otherwise skip.
  // Fire-and-forget: never block the client's form submission on
  // owner-side mail delivery.
  if (isEmailConfigured() && !isClientEmailPaused()) {
    const { data: orgRow } = (await admin
      .from("organizations")
      .select("name, contact_email, sender_email")
      .eq("id", client.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        name: string;
        contact_email: string | null;
        sender_email: string | null;
      } | null;
    };

    const notifyTo = orgRow?.contact_email ?? orgRow?.sender_email;
    if (notifyTo) {
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
      const subjectLine = `New booking request from ${client.name}`;
      const plainBody = [
        `${client.name} just requested a booking via the client portal.`,
        "",
        `Service: ${serviceType}`,
        preferredDate ? `Preferred date: ${preferredDate}` : null,
        preferredTimeWindow
          ? `Preferred time: ${preferredTimeWindow}`
          : null,
        address ? `Address: ${address}` : null,
        notes ? `Notes: ${notes}` : null,
        "",
        `Review + respond: ${siteUrl}/app/bookings/requests`,
      ]
        .filter(Boolean)
        .join("\n");

      // Minimal HTML — we could reuse the fancy template later, but
      // this is internal mail to the owner and plain text reads fine.
      const html = `<p>${client.name} just requested a booking via the client portal.</p>
<ul>
  <li><strong>Service:</strong> ${escapeHtml(serviceType)}</li>
  ${preferredDate ? `<li><strong>Preferred date:</strong> ${escapeHtml(preferredDate)}</li>` : ""}
  ${preferredTimeWindow ? `<li><strong>Preferred time:</strong> ${escapeHtml(preferredTimeWindow)}</li>` : ""}
  ${address ? `<li><strong>Address:</strong> ${escapeHtml(address)}</li>` : ""}
  ${notes ? `<li><strong>Notes:</strong> ${escapeHtml(notes)}</li>` : ""}
</ul>
<p><a href="${siteUrl}/app/bookings/requests">Review + respond →</a></p>`;

      sendOrgEmail(client.organization_id, {
        to: notifyTo,
        toName: orgRow?.name,
        subject: subjectLine,
        html,
        text: plainBody,
      }).catch((err) =>
        console.error("[booking-request] notify email failed:", err),
      );
    }
  }

  revalidatePath("/client/request");
  revalidatePath("/app/bookings/requests");
  return { ok: true, requestId: inserted.id };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
