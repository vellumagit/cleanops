"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { can } from "@/lib/auth";
import { logAuditEvent, type AuditEntity } from "@/lib/audit";
import {
  FreelancerContactSchema,
  JobOfferSchema,
} from "@/lib/validators/freelancer";
import { generateClaimToken } from "@/lib/claim-token";
import { composeOfferSms } from "@/lib/twilio";
import { sendOrgSms } from "@/lib/sms";

/**
 * Phase 11 server actions — freelancer bench.
 *
 * Entities touched here aren't in the `AuditEntity` union yet, so audit
 * rows use `"settings"` as a sentinel with the real entity in the
 * `after.entity_name` field. When the next phase expands the union we'll
 * retrofit proper values.
 */

const FREELANCER_ENTITY: AuditEntity = "settings";

// -----------------------------------------------------------------------------
// freelancer_contacts CRUD
// -----------------------------------------------------------------------------

type ContactField = keyof typeof FreelancerContactSchema.shape;
export type FreelancerContactFormState = ActionState<ContactField>;

function readContactForm(formData: FormData) {
  return {
    full_name: String(formData.get("full_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    // Unchecked checkboxes are absent from formData — "true" only if present.
    active: formData.has("active") ? "true" : "false",
  };
}

export async function createFreelancerContactAction(
  _prev: FreelancerContactFormState,
  formData: FormData,
): Promise<FreelancerContactFormState> {
  const raw = readContactForm(formData);
  const parsed = parseForm(FreelancerContactSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  const { data: inserted, error } = await supabase
    .from("freelancer_contacts")
    .insert({
      organization_id: membership.organization_id,
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      email: parsed.data.email ?? null,
      notes: parsed.data.notes ?? null,
      active: parsed.data.active,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return {
      errors: { _form: error?.message ?? "Insert failed" },
      values: raw,
    };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: FREELANCER_ENTITY,
    entity_id: inserted.id,
    after: {
      entity_name: "freelancer_contact",
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
    },
  });

  revalidatePath("/app/freelancers");
  redirect("/app/freelancers");
}

export async function updateFreelancerContactAction(
  id: string,
  _prev: FreelancerContactFormState,
  formData: FormData,
): Promise<FreelancerContactFormState> {
  const raw = readContactForm(formData);
  const parsed = parseForm(FreelancerContactSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  const { data: previous } = await supabase
    .from("freelancer_contacts")
    .select("full_name, phone, email, notes, active")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("freelancer_contacts")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      email: parsed.data.email ?? null,
      notes: parsed.data.notes ?? null,
      active: parsed.data.active,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };

  await logAuditEvent({
    membership,
    action: "update",
    entity: FREELANCER_ENTITY,
    entity_id: id,
    before: previous
      ? { entity_name: "freelancer_contact", ...previous }
      : null,
    after: {
      entity_name: "freelancer_contact",
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      active: parsed.data.active,
    },
  });

  revalidatePath("/app/freelancers");
  revalidatePath(`/app/freelancers/${id}/edit`);
  redirect("/app/freelancers");
}

export async function deleteFreelancerContactAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  const { data: previous } = await supabase
    .from("freelancer_contacts")
    .select("full_name, phone")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("freelancer_contacts")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: FREELANCER_ENTITY,
    entity_id: id,
    before: previous
      ? { entity_name: "freelancer_contact", ...previous }
      : null,
  });

  revalidatePath("/app/freelancers");
  redirect("/app/freelancers");
}

// -----------------------------------------------------------------------------
// Offer this shift — to your own subcontractors and/or the on-call pool
// -----------------------------------------------------------------------------

type OfferField = keyof typeof JobOfferSchema.shape | "contact_ids";
export type JobOfferFormState = ActionState<OfferField>;

function readOfferForm(formData: FormData) {
  return {
    booking_id: String(formData.get("booking_id") ?? ""),
    pay_dollars: String(formData.get("pay_dollars") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    positions_needed: String(formData.get("positions_needed") ?? "1"),
    expires_in_minutes: String(formData.get("expires_in_minutes") ?? "30"),
  };
}

function shortAddress(address: string | null | undefined): string {
  if (!address) return "On-site";
  const trimmed = address.split("\n")[0]?.trim() ?? "";
  return trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed;
}

function claimBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * Create a job_offer + one dispatch per selected recipient, send SMS for
 * each (or skip when Twilio is disabled), and redirect to the offer
 * detail page. Not atomic at the SQL level — if we crash halfway the
 * offer will still be open for the recipients we did dispatch to, which is
 * the correct failure mode.
 *
 * Two recipient kinds, one offer:
 *   contact_ids  on-call cleaners (freelancer_contacts) — earn the flat pay
 *   member_ids   the org's own roster subcontractors (memberships) — their
 *                SMS quotes "your usual rate", and claiming assigns them
 *                the booking instead of creating a paid claim
 */
export async function createJobOfferAction(
  _prev: JobOfferFormState,
  formData: FormData,
): Promise<JobOfferFormState> {
  const raw = readOfferForm(formData);
  const parsed = parseForm(JobOfferSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const contactIds = formData.getAll("contact_ids").map((v) => String(v));
  const memberIds = formData.getAll("member_ids").map((v) => String(v));
  if (contactIds.length === 0 && memberIds.length === 0) {
    return {
      errors: { contact_ids: "Pick at least one recipient" },
      values: raw,
    };
  }

  const { membership, supabase } = await getActionContext();
  // Sending an offer spends money — SMS out, and subcontractor pay owed if
  // someone claims it. Reachable from a booking as well as from On-call, so
  // the check belongs here rather than only on the page.
  if (!can(membership, "subcontractors")) {
    return {
      errors: {
        contact_ids:
          "Sending shift offers isn't part of your access. Ask an owner to turn it on.",
      },
      values: raw,
    };
  }

  // Sanity-check the booking is ours + fetch the fields we need for SMS.
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, service_type, address")
    .eq("id", parsed.data.booking_id)
    .maybeSingle();

  if (bookingErr || !booking) {
    return { errors: { _form: "Booking not found" }, values: raw };
  }

  // Sanity-check the contacts are ours + active + not opted out of SMS.
  type BenchContact = {
    id: string;
    full_name: string;
    phone: string;
    active: boolean;
    sms_opted_out_at: string | null;
  };
  // Select including the opt-out column. If the migration hasn't landed yet the
  // column is absent — fall back to the base columns so dispatch keeps working
  // (opt-out just isn't enforced until the migration runs). Order-independent.
  let contacts: BenchContact[] | null = null;
  let contactsErr: { message: string } | null = null;
  if (contactIds.length > 0) {
    const withOptOut = (await supabase
      .from("freelancer_contacts")
      .select("id, full_name, phone, active, sms_opted_out_at")
      .in("id", contactIds)) as unknown as {
      data: BenchContact[] | null;
      error: { message: string } | null;
    };
    if (withOptOut.error) {
      const base = (await supabase
        .from("freelancer_contacts")
        .select("id, full_name, phone, active")
        .in("id", contactIds)) as unknown as {
        data: Array<Omit<BenchContact, "sms_opted_out_at">> | null;
        error: { message: string } | null;
      };
      contacts = (base.data ?? []).map((c) => ({ ...c, sms_opted_out_at: null }));
      contactsErr = base.error;
    } else {
      contacts = withOptOut.data;
    }
    if (contactsErr) {
      return { errors: { _form: contactsErr.message }, values: raw };
    }
  }

  // `active` = on the on-call list; `sms_opted_out_at` = replied STOP.
  // Opted-out contacts are excluded unconditionally — re-texting them
  // violates their carrier opt-out (TCPA/CTIA), regardless of list status.
  const activeContacts = (contacts ?? []).filter(
    (c) => c.active && !c.sms_opted_out_at,
  );

  // Sanity-check the members are OUR roster subcontractors. engagement is
  // the gate: employees are scheduled, not offered — an open shift blast to
  // payroll staff would create overtime obligations nobody chose.
  type RosterMember = {
    id: string;
    display_name: string | null;
    contact_phone: string | null;
    profile: { full_name: string | null; phone: string | null } | null;
  };
  let rosterMembers: Array<{ id: string; name: string; phone: string }> = [];
  if (memberIds.length > 0) {
    const { memberDisplayName } = await import("@/lib/member-display");
    const { data: memberRows, error: memberErr } = (await supabase
      .from("memberships")
      .select(
        "id, display_name, contact_phone, profile:profiles ( full_name, phone )",
      )
      .in("id", memberIds)
      .eq("organization_id", membership.organization_id)
      .eq("status", "active")
      .eq("engagement" as never, "subcontractor" as never)) as unknown as {
      data: RosterMember[] | null;
      error: { message: string } | null;
    };
    if (memberErr) {
      return { errors: { _form: memberErr.message }, values: raw };
    }
    rosterMembers = (memberRows ?? [])
      .map((m) => ({
        id: m.id,
        name: memberDisplayName(m),
        phone: m.contact_phone ?? m.profile?.phone ?? "",
      }))
      .filter((m) => m.phone.length > 0);
  }

  if (activeContacts.length === 0 && rosterMembers.length === 0) {
    return {
      errors: {
        contact_ids:
          "Nobody left to text — the selected recipients are inactive, opted out, or have no phone on file.",
      },
      values: raw,
    };
  }

  const expiresAt = new Date(
    Date.now() + parsed.data.expires_in_minutes * 60_000,
  ).toISOString();

  // 1. Create the offer.
  const { data: offer, error: offerErr } = await supabase
    .from("job_offers")
    .insert({
      organization_id: membership.organization_id,
      booking_id: booking.id,
      posted_by: membership.id,
      pay_cents: parsed.data.pay_dollars,
      notes: parsed.data.notes ?? null,
      status: "open",
      expires_at: expiresAt,
      positions_needed: parsed.data.positions_needed,
      positions_filled: 0,
    } as never)
    .select("id")
    .single();

  if (offerErr || !offer) {
    return {
      errors: { _form: offerErr?.message ?? "Could not create offer" },
      values: raw,
    };
  }

  // 2. Insert one dispatch per recipient (queued status). Exactly one of
  //    contact_id / membership_id per row — the DB CHECK enforces it.
  const dispatchesToInsert = [
    ...activeContacts.map((c) => ({
      organization_id: membership.organization_id,
      offer_id: offer.id,
      contact_id: c.id,
      claim_token: generateClaimToken(),
      delivery_status: "queued",
    })),
    ...rosterMembers.map((m) => ({
      organization_id: membership.organization_id,
      offer_id: offer.id,
      membership_id: m.id,
      claim_token: generateClaimToken(),
      delivery_status: "queued",
    })),
  ];

  const { data: dispatches, error: dispErr } = (await supabase
    .from("job_offer_dispatches")
    .insert(dispatchesToInsert as never)
    .select("id, contact_id, membership_id, claim_token" as never)) as unknown as {
    data: Array<{
      id: string;
      contact_id: string | null;
      membership_id: string | null;
      claim_token: string;
    }> | null;
    error: { message: string } | null;
  };

  if (dispErr || !dispatches) {
    return {
      errors: { _form: dispErr?.message ?? "Could not create dispatches" },
      values: raw,
    };
  }

  // 3. For each dispatch, compose and send the SMS, then update the row.
  const base = claimBaseUrl();
  const addressShort = shortAddress(booking.address);
  const { getOrgTimezone } = await import("@/lib/org-timezone");
  const orgTz = await getOrgTimezone(membership.organization_id);

  for (const d of dispatches) {
    const contact = d.contact_id
      ? activeContacts.find((c) => c.id === d.contact_id)
      : undefined;
    const member = d.membership_id
      ? rosterMembers.find((m) => m.id === d.membership_id)
      : undefined;
    const to = contact?.phone ?? member?.phone;
    if (!to) continue;

    // Same offer, different deal: on-call cleaners are quoted the flat pay;
    // roster subcontractors are told "your usual rate" (composeOfferSms
    // handles both, including the STOP line only on-call texts carry).
    const body = composeOfferSms({
      serviceType: booking.service_type,
      scheduledAt: booking.scheduled_at,
      durationMinutes: booking.duration_minutes,
      payCents: contact ? parsed.data.pay_dollars : null,
      audience: contact ? "oncall" : "roster",
      addressShort,
      claimUrl: `${base}/claim/${d.claim_token}`,
      positionsNeeded: parsed.data.positions_needed,
      tz: orgTz,
    });

    // Routed through sendOrgSms so shift offers send from the org's OWN
    // number and count toward its allotment. Not client-facing (crew and
    // independent contractors), so the opt-in gate is bypassed; the
    // automation key defaults ON. Requires the org to have SMS enabled.
    const result = await sendOrgSms(membership.organization_id, {
      to,
      body,
      automationKey: "freelancer_offer_sms",
    });

    if (result.ok) {
      await supabase
        .from("job_offer_dispatches")
        .update({
          delivery_status: result.status,
          twilio_sid: result.sid,
        })
        .eq("id", d.id);
    } else {
      await supabase
        .from("job_offer_dispatches")
        .update({
          delivery_status: "failed",
          delivery_error: result.error.slice(0, 500),
        })
        .eq("id", d.id);
    }
  }

  // 4. Stamp last_offered_at on every dispatched contact. (Roster members
  //    have no such column — their activity lives on the booking itself.)
  if (activeContacts.length > 0) {
    await supabase
      .from("freelancer_contacts")
      .update({ last_offered_at: new Date().toISOString() })
      .in(
        "id",
        activeContacts.map((c) => c.id),
      );
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: FREELANCER_ENTITY,
    entity_id: offer.id,
    after: {
      entity_name: "job_offer",
      booking_id: booking.id,
      pay_cents: parsed.data.pay_dollars,
      dispatch_count: dispatches.length,
      oncall_count: activeContacts.length,
      roster_count: rosterMembers.length,
      expires_at: expiresAt,
    },
  });

  revalidatePath("/app/freelancers/offers");
  revalidatePath(`/app/bookings/${booking.id}`);
  redirect(`/app/freelancers/offers/${offer.id}`);
}

export async function cancelJobOfferAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  const { data: previous } = await supabase
    .from("job_offers")
    .select("status, booking_id")
    .eq("id", id)
    .maybeSingle();

  if (!previous || previous.status !== "open") return;

  const { error } = await supabase
    .from("job_offers")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: FREELANCER_ENTITY,
    entity_id: id,
    before: { entity_name: "job_offer", status: previous.status },
    after: { entity_name: "job_offer", status: "cancelled" },
  });

  revalidatePath("/app/freelancers/offers");
  revalidatePath(`/app/freelancers/offers/${id}`);
  if (previous.booking_id) {
    revalidatePath(`/app/bookings/${previous.booking_id}`);
  }
}
