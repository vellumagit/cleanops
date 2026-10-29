"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import { planOfferSwap, type CrewRow } from "@/lib/offer-swap";
import { syncJob } from "@/lib/job-sync";

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
  | {
      ok: false;
      reason:
        | "already_filled"
        | "already_claimed"
        | "expired"
        | "cancelled"
        | "invalid"
        | "error";
      message?: string;
    };

export async function claimOfferAction(token: string): Promise<ClaimResult> {
  if (!token) return { ok: false, reason: "invalid" };

  const admin = createSupabaseAdminClient();

  // 1. Look up the dispatch by token. The recipient is EITHER an on-call
  //    contact or one of the org's own roster subcontractors (memberships) —
  //    exactly one of the two ids is set, enforced by a DB CHECK.
  const { data: dispatch, error: dispatchErr } = (await admin
    .from("job_offer_dispatches")
    .select(
      "id, organization_id, offer_id, contact_id, membership_id, offer:job_offers ( id, status, expires_at, booking_id )" as never,
    )
    .eq("claim_token", token)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      offer_id: string;
      contact_id: string | null;
      membership_id: string | null;
      offer: {
        id: string;
        status: string;
        expires_at: string | null;
        booking_id: string | null;
      } | null;
    } | null;
    error: { message: string } | null;
  };

  if (dispatchErr || !dispatch || !dispatch.offer) {
    return { ok: false, reason: "invalid" };
  }

  const recipientCol = dispatch.membership_id ? "membership_id" : "contact_id";
  const recipientId = dispatch.membership_id ?? dispatch.contact_id;
  if (!recipientId) return { ok: false, reason: "invalid" };

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

  // Check if this recipient already claimed this offer.
  const { data: existingClaim } = await admin
    .from("job_offer_claims" as never)
    .select("id")
    .eq("offer_id", offer.id)
    .eq(recipientCol, recipientId)
    .maybeSingle();

  if (existingClaim) {
    return {
      ok: false,
      reason: "already_claimed",
      message: "You already claimed this shift.",
    };
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
    filled_membership_id: dispatch.membership_id,
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
  //    Exactly one of contact_id / membership_id, mirroring the dispatch.
  await admin.from("job_offer_claims" as never).insert({
    organization_id: dispatch.organization_id,
    offer_id: offer.id,
    contact_id: dispatch.contact_id,
    membership_id: dispatch.membership_id,
    dispatch_id: dispatch.id,
    claimed_at: new Date().toISOString(),
  } as never);

  // 4. Stamp the dispatch row that actually claimed + the contact's
  //    last_accepted_at (a contacts-only column).
  await admin
    .from("job_offer_dispatches")
    .update({ responded_at: new Date().toISOString() })
    .eq("id", dispatch.id);

  if (dispatch.contact_id) {
    await admin
      .from("freelancer_contacts")
      .update({ last_accepted_at: new Date().toISOString() })
      .eq("id", dispatch.contact_id);
  }

  // 4b. What the claim does to the job's crew.
  //
  //   - A roster member's claim MEANS assignment. They're a membership, so
  //     the booking machinery can — and must — record them directly: field
  //     tools, checklists, clock-in and clocked-hours pay all key off the
  //     assignment, not the claim. (Pay note: membership claims carry no flat
  //     pay; see the migration.)
  //   - An offer posted to REPLACE someone swaps them off on the first claim,
  //     whoever claims it. See lib/offer-swap.ts.
  let replacedId: string | null = null;
  let swap:
    | { kind: "swapped"; replacedId: string }
    | { kind: "blocked"; replacedId: string; reason: "started" | "clocked_in" }
    | null = null;
  {
    // Separate read, tolerant of a database without the column yet.
    const { data: repRow, error: repErr } = (await admin
      .from("job_offers")
      .select("replaces_membership_id" as never)
      .eq("id", offer.id)
      .maybeSingle()) as unknown as {
      data: { replaces_membership_id: string | null } | null;
      error: { message: string } | null;
    };
    replacedId = repErr ? null : (repRow?.replaces_membership_id ?? null);
  }

  if (offer.booking_id && (dispatch.membership_id || replacedId)) {
    try {
      const { data: bookingRow } = (await admin
        .from("bookings")
        .select("id, organization_id, assigned_to, status")
        .eq("id", offer.booking_id)
        .maybeSingle()) as unknown as {
        data: {
          id: string;
          organization_id: string;
          assigned_to: string | null;
          status: string;
        } | null;
      };

      if (bookingRow) {
        const { data: assigneeRows } = await admin
          .from("booking_assignees")
          .select("membership_id, is_primary")
          .eq("booking_id", bookingRow.id);

        let replacedClockedIn = false;
        if (replacedId) {
          const { data: entries } = await admin
            .from("time_entries")
            .select("id")
            .eq("booking_id", bookingRow.id)
            .eq("employee_id", replacedId)
            .limit(1);
          replacedClockedIn = (entries ?? []).length > 0;
        }

        const plan = planOfferSwap({
          replacedId,
          claimerMembershipId: dispatch.membership_id,
          isFirstClaim: newFilledCount === 1,
          crew: (assigneeRows ?? []) as CrewRow[],
          assignedTo: bookingRow.assigned_to,
          bookingStatus: bookingRow.status,
          replacedClockedIn,
        });

        let crewChanged = false;
        const now = new Date().toISOString();

        // The claimer's own row — unless the swap hands them the replaced
        // person's row instead.
        if (
          dispatch.membership_id &&
          (plan.kind !== "swap" || plan.insertClaimer)
        ) {
          const alreadyOn =
            bookingRow.assigned_to === dispatch.membership_id ||
            (assigneeRows ?? []).some(
              (a) => a.membership_id === dispatch.membership_id,
            );
          if (!alreadyOn) {
            const hasPrimary =
              bookingRow.assigned_to != null ||
              (assigneeRows ?? []).some((a) => a.is_primary);
            // Claiming IS accepting — don't re-ask them to confirm a shift
            // they just grabbed on their own initiative.
            await admin.from("booking_assignees").insert({
              organization_id: dispatch.organization_id,
              booking_id: bookingRow.id,
              membership_id: dispatch.membership_id,
              is_primary: !hasPrimary,
              acceptance_status: "accepted",
              responded_at: now,
            } as never);
            // Keep the denormalised primary pointer consistent with the
            // backfill invariant: assigned_to set ⇔ a primary assignee row.
            if (!hasPrimary) {
              await admin
                .from("bookings")
                .update({ assigned_to: dispatch.membership_id })
                .eq("id", bookingRow.id)
                .is("assigned_to", null);
            }
            crewChanged = true;
          }
        }

        if (plan.kind === "swap" && replacedId) {
          if (plan.reassignRow && dispatch.membership_id) {
            await admin
              .from("booking_assignees")
              .update({
                membership_id: dispatch.membership_id,
                acceptance_status: "accepted",
                responded_at: now,
              } as never)
              .eq("booking_id", bookingRow.id)
              .eq("membership_id", replacedId);
          }
          if (plan.deleteRow) {
            await admin
              .from("booking_assignees")
              .delete()
              .eq("booking_id", bookingRow.id)
              .eq("membership_id", replacedId);
          }
          if (plan.assignedTo !== undefined) {
            await admin
              .from("bookings")
              .update({ assigned_to: plan.assignedTo })
              .eq("id", bookingRow.id);
          }
          if (plan.newPrimary) {
            await admin
              .from("booking_assignees")
              .update({ is_primary: false } as never)
              .eq("booking_id", bookingRow.id);
            await admin
              .from("booking_assignees")
              .update({ is_primary: true } as never)
              .eq("booking_id", bookingRow.id)
              .eq("membership_id", plan.newPrimary);
          }
          swap = { kind: "swapped", replacedId };
          crewChanged = true;
        } else if (plan.kind === "blocked" && replacedId) {
          swap = { kind: "blocked", replacedId, reason: plan.reason };
        }

        if (crewChanged) {
          await syncClaimCalendars(admin, bookingRow.id);
          // The roster is the job's shape: who it waits on, and the window
          // length when hours are divided. Recompute like every other crew
          // change does.
          await syncJob(bookingRow.id, "crew_changed");
        }
      }
    } catch (assignErr) {
      // The claim stands even if the assignment write hiccups — the offer
      // detail page still shows who claimed, and a manager can assign by
      // hand. Losing the claim over this would be strictly worse.
      console.error("[claim] crew update failed:", assignErr);
    }
  }

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
      filled_membership_id: dispatch.membership_id,
      via: "public_claim_link",
      replaced_membership_id: swap?.kind === "swapped" ? swap.replacedId : null,
      swap_blocked: swap?.kind === "blocked" ? swap.reason : null,
    } as never,
  });

  // 6. Round it out: alert the org that the shift was claimed, and text the
  //    freelancer their confirmed details. Best-effort — a notification or SMS
  //    hiccup must never fail the claim itself.
  try {
    const [contactRes, memberRes, bookingRes, orgRes] = await Promise.all([
      dispatch.contact_id
        ? admin
            .from("freelancer_contacts")
            .select("full_name, phone")
            .eq("id", dispatch.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      dispatch.membership_id
        ? admin
            .from("memberships")
            .select(
              "id, display_name, contact_phone, profile:profiles ( full_name, phone )",
            )
            .eq("id", dispatch.membership_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
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
    const member = memberRes.data as {
      id: string;
      display_name: string | null;
      contact_phone: string | null;
      profile: { full_name: string | null; phone: string | null } | null;
    } | null;
    const bookingRow = bookingRes.data as {
      id: string;
      service_type: string;
      scheduled_at: string;
      address: string | null;
      client: { name: string | null } | null;
    } | null;
    const orgName = (orgRes.data as { name?: string } | null)?.name ?? "Sollos";
    const { memberDisplayName } = await import("@/lib/member-display");
    const recipientPhone =
      contact?.phone ?? member?.contact_phone ?? member?.profile?.phone ?? null;
    const freelancerName = contact
      ? (contact.full_name ?? "A subcontractor")
      : member
        ? `${memberDisplayName(member)} (your subcontractor)`
        : "A subcontractor";

    // Notify org management — this is what makes the claim "reflect" for the
    // owner/managers, with a link straight to the booking.
    const { notify } = await import("@/lib/notify");
    // Same timezone the confirmation SMS below uses. One claim event was
    // emitting two different times for the same shift — the manager's
    // notification in US Eastern, the freelancer's text in the org's zone.
    // getOrgTimezone is React-cache()'d, so the second call is free.
    const { getOrgTimezone } = await import("@/lib/org-timezone");
    const orgTz = await getOrgTimezone(dispatch.organization_id);
    const svc = bookingRow ? humanizeEnum(bookingRow.service_type) : "shift";
    const when = bookingRow
      ? ` on ${formatDateTime(bookingRow.scheduled_at, orgTz)}`
      : "";
    // Who they covered for, by name — or why that person is still on it.
    let swapLine = "";
    let replacedName: string | null = null;
    if (swap) {
      const { data: rep } = (await admin
        .from("memberships")
        .select("display_name, profile:profiles ( full_name )")
        .eq("id", swap.replacedId)
        .maybeSingle()) as unknown as {
        data: {
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      };
      replacedName = rep ? memberDisplayName(rep) : "the cleaner they replaced";
      swapLine =
        swap.kind === "swapped"
          ? ` They've taken ${replacedName}'s spot, and ${replacedName} is off the job.`
          : ` ${replacedName} is still on the job — ${
              swap.reason === "clocked_in"
                ? "they've already clocked in"
                : "it has already started"
            } — so take them off by hand if they're not there.`;
    }
    await notify({
      organizationId: dispatch.organization_id,
      audience: "org-management",
      type: "shift_claimed",
      title: "Shift claimed",
      body: `${freelancerName} claimed the ${svc} shift${when}.${swapLine}`,
      href: offer.booking_id
        ? `/app/bookings/${offer.booking_id}`
        : `/app/freelancers/offers/${offer.id}`,
    });

    // The person who was out hears they're off it — otherwise they find out
    // from the board, or by turning up.
    if (swap?.kind === "swapped" && bookingRow) {
      const coverName = contact?.full_name ?? (member ? memberDisplayName(member) : "Someone");
      await notify({
        organizationId: dispatch.organization_id,
        audience: "membership",
        membershipId: swap.replacedId,
        title: "You're off this shift",
        body: `${coverName} is covering ${bookingRow.client?.name ?? "the"} ${svc} shift${when}. You don't need to go.`,
        href: "/field/jobs",
      });
    }

    // Confirmation text to whoever claimed — on-call cleaner or roster
    // subcontractor — with the essentials + a link back to the full details
    // page (address, map, client phone). The claim URL works for both,
    // including shadow-membership subcontractors who have no login.
    if (recipientPhone && bookingRow) {
      const { sendOrgSms } = await import("@/lib/sms");
      const { composeShiftClaimedConfirmationSms } =
        await import("@/lib/twilio");
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
      const body = composeShiftClaimedConfirmationSms({
        orgName,
        serviceType: bookingRow.service_type,
        scheduledAt: bookingRow.scheduled_at,
        clientName: bookingRow.client?.name ?? null,
        claimUrl: `${base}/claim/${token}`,
        tz: orgTz,
      });
      await sendOrgSms(dispatch.organization_id, {
        to: recipientPhone,
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

/**
 * Bring every calendar in line with who is on the job NOW. Read fresh after
 * the claim's writes: syncMemberCalendarEvents deletes events for anyone
 * missing from the list, which is exactly what removes the replaced person's
 * event — and exactly why a stale list would wipe someone still on the crew.
 * Never fails the claim.
 */
async function syncClaimCalendars(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bookingId: string,
): Promise<void> {
  try {
    const [{ data: b }, { data: rows }] = await Promise.all([
      admin
        .from("bookings")
        .select(
          "id, organization_id, assigned_to, scheduled_at, duration_minutes, service_type, address, notes, google_calendar_event_id, client:clients ( name )",
        )
        .eq("id", bookingId)
        .maybeSingle() as unknown as Promise<{
        data: {
          id: string;
          organization_id: string;
          assigned_to: string | null;
          scheduled_at: string;
          duration_minutes: number;
          service_type: string;
          address: string | null;
          notes: string | null;
          google_calendar_event_id: string | null;
          client: { name: string | null } | null;
        } | null;
      }>,
      admin
        .from("booking_assignees")
        .select("membership_id")
        .eq("booking_id", bookingId),
    ]);
    if (!b) return;

    const { syncMemberCalendarEvents, updateCalendarEvent } = await import(
      "@/lib/google-calendar"
    );
    const { memberDisplayName } = await import("@/lib/member-display");
    const everyone = Array.from(
      new Set([
        ...(b.assigned_to ? [b.assigned_to] : []),
        ...(rows ?? []).map((r) => r.membership_id),
      ]),
    );
    const eventBooking = {
      id: b.id,
      scheduled_at: b.scheduled_at,
      duration_minutes: b.duration_minutes,
      service_type: b.service_type,
      address: b.address,
      notes: b.notes,
      client_name: b.client?.name ?? undefined,
    };
    await syncMemberCalendarEvents(b.id, everyone, eventBooking).catch((err) =>
      console.error("[claim] member gcal sync failed:", err),
    );
    // The org event's assignee label too, so the calendar Svitlana looks at
    // says who is coming.
    if (b.google_calendar_event_id) {
      const lead = b.assigned_to ?? everyone[0] ?? null;
      const { data: leadRow } = lead
        ? ((await admin
            .from("memberships")
            .select("display_name, profile:profiles ( full_name )")
            .eq("id", lead)
            .maybeSingle()) as unknown as {
            data: {
              display_name: string | null;
              profile: { full_name: string | null } | null;
            } | null;
          })
        : { data: null };
      await updateCalendarEvent(b.organization_id, {
        ...eventBooking,
        google_calendar_event_id: b.google_calendar_event_id,
        employee_name: leadRow ? memberDisplayName(leadRow) : undefined,
      }).catch((err) => console.error("[claim] org gcal update failed:", err));
    }
  } catch (err) {
    console.error("[claim] calendar sync setup failed:", err);
  }
}
