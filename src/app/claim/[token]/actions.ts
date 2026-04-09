"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Claim a shift offer via the unique token sent to one freelancer.
 *
 * This action runs with the SERVICE-ROLE client because the caller is a
 * freelancer who is NOT an authenticated Sollos user. The token itself is
 * the capability: 16 URL-safe chars = 96 bits of entropy per dispatch, so
 * it is not guessable at any practical rate.
 *
 * Race handling: the UPDATE is guarded by `status = 'open'` so only one
 * caller can succeed in flipping an offer to `filled`. The second caller
 * gets zero updated rows and we return a "already filled" result.
 */

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "already_filled" | "expired" | "cancelled" | "invalid" | "error"; message?: string };

export async function claimOfferAction(token: string): Promise<ClaimResult> {
  if (!token) return { ok: false, reason: "invalid" };

  const admin = createSupabaseAdminClient();

  // 1. Look up the dispatch by token. This also gives us the offer id,
  //    contact id, and organization id we need to update siblings.
  const { data: dispatch, error: dispatchErr } = await admin
    .from("job_offer_dispatches")
    .select(
      "id, organization_id, offer_id, contact_id, offer:job_offers ( id, status, expires_at, booking_id )",
    )
    .eq("claim_token", token)
    .maybeSingle();

  if (dispatchErr || !dispatch || !dispatch.offer) {
    return { ok: false, reason: "invalid" };
  }

  const offer = dispatch.offer;

  if (offer.status === "cancelled") return { ok: false, reason: "cancelled" };
  if (offer.status === "expired") return { ok: false, reason: "expired" };

  if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
    // Lazily mark expired so the state is consistent with the clock.
    await admin
      .from("job_offers")
      .update({ status: "expired" })
      .eq("id", offer.id)
      .eq("status", "open");
    return { ok: false, reason: "expired" };
  }

  if (offer.status === "filled") {
    return { ok: false, reason: "already_filled" };
  }

  // 2. Atomic claim. `status = 'open'` is the race guard.
  const { data: updated, error: updateErr } = await admin
    .from("job_offers")
    .update({
      status: "filled",
      filled_contact_id: dispatch.contact_id,
      filled_at: new Date().toISOString(),
    })
    .eq("id", offer.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (updateErr) {
    return { ok: false, reason: "error", message: updateErr.message };
  }
  if (!updated) {
    // Someone else won the race between the status check and the update.
    return { ok: false, reason: "already_filled" };
  }

  // 3. Stamp the dispatch row that actually claimed + the contact's
  //    last_accepted_at.
  await admin
    .from("job_offer_dispatches")
    .update({ responded_at: new Date().toISOString() })
    .eq("id", dispatch.id);

  await admin
    .from("freelancer_contacts")
    .update({ last_accepted_at: new Date().toISOString() })
    .eq("id", dispatch.contact_id);

  // 4. Audit log — written with service-role so we bypass the insert
  //    policy but still get a row tagged to the org. No actor_id since the
  //    claimant is not a membership.
  await admin.from("audit_log").insert({
    organization_id: dispatch.organization_id,
    actor_id: null,
    action: "status_change",
    entity: "settings",
    entity_id: offer.id,
    before: { entity_name: "job_offer", status: "open" } as never,
    after: {
      entity_name: "job_offer",
      status: "filled",
      filled_contact_id: dispatch.contact_id,
      via: "public_claim_link",
    } as never,
  });

  revalidatePath(`/app/freelancers/offers/${offer.id}`);
  if (offer.booking_id) {
    revalidatePath(`/app/bookings/${offer.booking_id}`);
  }
  revalidatePath(`/claim/${token}`);

  return { ok: true };
}
