"use server";

import "server-only";
import { requireClientAction } from "@/lib/client-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  askToMoveVisit,
  leaveVisitNote,
  skipVisit,
  type ClientJobActionState,
  type RequestVisit,
} from "@/lib/client-visit-requests";

export type { ClientJobActionState } from "@/lib/client-visit-requests";

/**
 * Everything a signed-in client can do to a visit they already have. The
 * rules live in lib/client-visit-requests.ts, shared with the private link
 * in booking emails (app/v/[token]); this file is the signed-in door.
 *
 * Ownership is proven here, twice: requireClientAction() resolves the
 * session to one clients row, and the visit is loaded by that client_id.
 */

/** Load the booking and prove this client owns it. Returns null otherwise. */
async function ownedBooking(bookingId: string, clientId: string): Promise<RequestVisit | null> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("bookings")
    .select(
      "id, organization_id, client_id, series_id, scheduled_at, status, archived_at, assigned_to, address, service_type_label, service_type",
    )
    .eq("id", bookingId)
    .eq("client_id", clientId)
    .maybeSingle()) as unknown as { data: RequestVisit | null };
  return data;
}

export async function leaveJobNoteAction(_prev: ClientJobActionState, formData: FormData): Promise<ClientJobActionState> {
  const client = await requireClientAction();
  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) return { error: "Missing job." };
  const booking = await ownedBooking(bookingId, client.id);
  if (!booking) return { error: "Job not found." };
  return leaveVisitNote(client, booking, String(formData.get("body") ?? ""));
}

export async function requestSkipAction(_prev: ClientJobActionState, formData: FormData): Promise<ClientJobActionState> {
  const client = await requireClientAction();
  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) return { error: "Missing job." };
  const booking = await ownedBooking(bookingId, client.id);
  if (!booking) return { error: "Job not found." };
  return skipVisit(client, booking, String(formData.get("reason") ?? ""));
}

export async function askToMoveAction(_prev: ClientJobActionState, formData: FormData): Promise<ClientJobActionState> {
  const client = await requireClientAction();
  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) return { error: "Missing job." };
  const booking = await ownedBooking(bookingId, client.id);
  if (!booking) return { error: "Job not found." };
  return askToMoveVisit(client, booking, String(formData.get("wish") ?? ""));
}
