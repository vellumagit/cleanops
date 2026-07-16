"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, humanizeEnum } from "@/lib/format";

/**
 * Claim a shift offer via the unique token sent to one freelancer.
 *
 * This action runs with the SERVICE-ROLE client because the caller is a
 * freelancer who is NOT an authenticated Sollos user. The token itself is
 * the capability: 16 URL-safe chars = 96 bits of entropy per dispatch, so
 * it is not guessable at any practical rate.
 *
 * Multi-position support:
 *   - `positions_needed` controls how many freelancers can claim one offer.
 *   - Each claim atomically increments `positions_filled` and inserts a
 *     `job_offer_claims` row.
 *   - The offer flips to `status = 'filled'` only when
 *     `positions_filled = positions_needed`.
 *   - The same contact cannot claim the same offer twice (UNIQUE constraint).
 *
 * Race handling: the UPDATE is guarded by `status = 'open'` AND
 * `positions_filled < positions_needed` so concurrent claims beyond the
 * limit are rejected. The per-contact uniqueness is enforced by the
 * `job_offer_claims (offer_id, contact_id)` UNIQUE constraint.
 */

export type ClaimResult =
  | { ok: true; spotsRemaining: number }
  | { ok: false; reason: "already_filled" | "already_claimed" | "expired" | "cancelled" | "invalid" | "error"; message?: string };

export async function claimOfferAction(token: string): Promise<ClaimResult> {
  if (!token) return { ok: false, reason: "invalid" };

  const admin = createSupabaseAdminClient();

  // 1. Look up the dispatch by token.
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

  // Fetch positions columns separately (not in generated types yet).
  const { data: positionsData } = await admin
    .from("job_offers")
    .select("positions_needed, positions_filled" as never)
    .eq("id", dispatch.offer.id)
    .maybeSingle();

  const posRow = positionsData as Record<string, number> | null;

  const offer = {
    ...dispatch.offer,
    positions_needed: posRow?.positions_needed ?? 1,
    positions_filled: posRow?.positions_filled ?? 0,
  };

  if (offer.status === "cancelled") return { ok: false, reason: "cancelled" };
  if (offer.status === "expired") return { ok: false, reason: "expired" };

  if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
    await admin
      .from("job_offers")
      .update({ status: "expired" } as never)
      .eq("id", offer.id)
      .eq("status", "open");
    return { ok: false, reason: "expired" };
  }

  if (offer.status === "filled") {
    return { ok: false, reason: "already_filled" };
  }

  // Check if this contact already claimed this offer.
  const { data: existingClaim } = await admin
    .from("job_offer_claims" as never)
    .select("id")
    .eq("offer_id", offer.id)
    .eq("contact_id", dispatch.contact_id)
    .maybeSingle();

  if (existingClaim) {
    return { ok: false, reason: "already_claimed", message: "You already claimed this shift." };
  }

  // 2. Determine the new filled count and whether this claim completes the offer.
  const newFilledCount = (offer.positions_filled ?? 0) + 1;
  const positionsNeeded = offer.positions_needed ?? 1;
  const isFinalClaim = newFilledCount >= positionsNeeded;

  // Atomic claim: only succeeds if the offer is still 'open'.
  // We update positions_filled and optionally flip status to 'filled'.
  const updatePayload: Record<string, unknown> = {
    positions_filled: newFilledCount,
    filled_contact_id: dispatch.contact_id,
    filled_at: new Date().toISOString(),
  };
  if (isFinalClaim) {
    updatePayload.status = "filled";
  }

  const { data: updated, error: updateErr } = await admin
    .from("job_offers")
    .update(updatePayload as never)
    .eq("id", offer.id)
    .eq("status", "open")
    // Guard against concurrent over-filling
    .lt("positions_filled" as never, positionsNeeded)
    .select("id, positions_filled")
    .maybeSingle();

  if (updateErr) {
    return { ok: false, reason: "error", message: updateErr.message };
  }
  if (!updated) {
    // Either someone else won the last spot or offer was closed.
    return { ok: false, reason: "already_filled" };
  }

  // 3. Record the claim in job_offer_claims for multi-position tracking.
  await admin.from("job_offer_claims" as never).insert({
    organization_id: dispatch.organization_id,
    offer_id: offer.id,
    contact_id: dispatch.contact_id,
    dispatch_id: dispatch.id,
    claimed_at: new Date().toISOString(),
  } as never);

  // 4. Stamp the dispatch row that actually claimed + the contact's
  //    last_accepted_at.
  await admin
    .from("job_offer_dispatches")
    .update({ responded_at: new Date().toISOString() })
    .eq("id", dispatch.id);

  await admin
    .from("freelancer_contacts")
    .update({ last_accepted_at: new Date().toISOString() })
    .eq("id", dispatch.contact_id);

  // 5. Audit log.
  const spotsRemaining = positionsNeeded - newFilledCount;
  await admin.from("audit_log").insert({
    organization_id: dispatch.organization_id,
    actor_id: null,
    action: "status_change",
    entity: "settings",
    entity_id: offer.id,
    before: {
      entity_name: "job_offer",
      status: "open",
      positions_filled: offer.positions_filled,
    } as never,
    after: {
      entity_name: "job_offer",
      status: isFinalClaim ? "filled" : "open",
      positions_filled: newFilledCount,
      filled_contact_id: dispatch.contact_id,
      via: "public_claim_link",
    } as never,
  });

  // 6. Round it out: alert the org that the shift was claimed, and text the
  //    freelancer their confirmed details. Best-effort — a notification or SMS
  //    hiccup must never fail the claim itself.
  try {
    const [contactRes, bookingRes, orgRes] = await Promise.all([
      admin
        .from("freelancer_contacts")
        .select("full_name, phone")
        .eq("id", dispatch.contact_id)
        .maybeSingle(),
      offer.booking_id
        ? admin
            .from("bookings")
            .select(
              "id, service_type, scheduled_at, address, client:clients ( name )",
            )
            .eq("id", offer.booking_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("organizations")
        .select("name")
        .eq("id", dispatch.organization_id)
        .maybeSingle(),
    ]);

    const contact = contactRes.data as {
      full_name: string | null;
      phone: string | null;
    } | null;
    const bookingRow = bookingRes.data as {
      id: string;
      service_type: string;
      scheduled_at: string;
      address: string | null;
      client: { name: string | null } | null;
    } | null;
    const orgName =
      (orgRes.data as { name?: string } | null)?.name ?? "Sollos";
    const freelancerName = contact?.full_name ?? "A freelancer";

    // Notify org management — this is what makes the claim "reflect" for the
    // owner/managers, with a link straight to the booking.
    const { notify } = await import("@/lib/notify");
    const svc = bookingRow ? humanizeEnum(bookingRow.service_type) : "shift";
    const when = bookingRow ? ` on ${formatDateTime(bookingRow.scheduled_at)}` : "";
    await notify({
      organizationId: dispatch.organization_id,
      audience: "org-management",
      type: "shift_claimed",
      title: "Shift claimed",
      body: `${freelancerName} claimed the ${svc} shift${when}.`,
      href: offer.booking_id
        ? `/app/bookings/${offer.booking_id}`
        : `/app/freelancers/offers/${offer.id}`,
    });

    // Confirmation text to the freelancer with the essentials + a link back to
    // the full details page (address, map, client phone).
    if (contact?.phone && bookingRow) {
      const { sendOrgSms } = await import("@/lib/sms");
      const { composeShiftClaimedConfirmationSms } = await import("@/lib/twilio");
      const { getOrgTimezone } = await import("@/lib/org-timezone");
      const base =
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
      const body = composeShiftClaimedConfirmationSms({
        orgName,
        serviceType: bookingRow.service_type,
        scheduledAt: bookingRow.scheduled_at,
        clientName: bookingRow.client?.name ?? null,
        claimUrl: `${base}/claim/${token}`,
        tz: await getOrgTimezone(dispatch.organization_id),
      });
      await sendOrgSms(dispatch.organization_id, {
        to: contact.phone,
        body,
        automationKey: "freelancer_offer_sms",
      });
    }
  } catch (roundoutErr) {
    console.error("[claim] post-claim notify/SMS failed:", roundoutErr);
  }

  revalidatePath(`/app/freelancers/offers/${offer.id}`);
  if (offer.booking_id) {
    revalidatePath(`/app/bookings/${offer.booking_id}`);
  }
  revalidatePath(`/claim/${token}`);

  return { ok: true, spotsRemaining };
}
