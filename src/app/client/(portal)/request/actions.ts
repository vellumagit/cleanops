"use server";

import "server-only";
import { requireClientAction } from "@/lib/client-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { fileBookingRequest } from "@/lib/booking-request";

export type RequestBookingState = {
  error?: string;
  ok?: boolean;
  requestId?: string;
};

/**
 * A signed-in client asks for a clean from /client/request. The request
 * itself is filed by lib/booking-request.ts, which a company's booking page
 * shares; this is the signed-in door onto it.
 */
export async function submitBookingRequestAction(
  _prev: RequestBookingState,
  formData: FormData,
): Promise<RequestBookingState> {
  const client = await requireClientAction();

  // Each request alerts every manager and sends the company an email that
  // counts against its daily cap. Five an hour is a person; more is a
  // login being used to flood the business or burn its cap.
  const rl = await checkRateLimit(`portal-req:${client.id}`, 5, 3_600_000);
  if (!rl.allowed) {
    return { error: "You've sent a few requests in the last hour. Give the team a moment to reply." };
  }

  const res = await fileBookingRequest({
    organizationId: client.organization_id,
    client: { id: client.id, name: client.name },
    serviceType: String(formData.get("service_type") ?? ""),
    preferredDate: String(formData.get("preferred_date") ?? ""),
    preferredTimeWindow: String(formData.get("preferred_time_window") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    via: "client area",
  });
  return res.ok ? { ok: true, requestId: res.requestId } : { error: res.error };
}
