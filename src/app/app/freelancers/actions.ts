"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent, type AuditEntity } from "@/lib/audit";
import {
  FreelancerContactSchema,
  JobOfferSchema,
} from "@/lib/validators/freelancer";
import { generateClaimToken } from "@/lib/claim-token";
import { sendSms, composeOfferSms } from "@/lib/twilio";

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
// Send to bench
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
 * Create a job_offer + one dispatch per selected contact, send SMS for
 * each (or skip when Twilio is disabled), and redirect to the offer
 * detail page. Not atomic at the SQL level — if we crash halfway the
 * offer will still be open for the contacts we did dispatch to, which is
 * the correct failure mode.
 */
export async function createJobOfferAction(
  _prev: JobOfferFormState,
  formData: FormData,
): Promise<JobOfferFormState> {
  const raw = readOfferForm(formData);
  const parsed = parseForm(JobOfferSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const contactIds = formData.getAll("contact_ids").map((v) => String(v));
  if (contactIds.length === 0) {
    return {
      errors: { contact_ids: "Pick at least one freelancer" },
      values: raw,
    };
  }

  const { membership, supabase } = await getActionContext();

  // Sanity-check the booking is ours + fetch the fields we need for SMS.
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_minutes, service_type, address")
    .eq("id", parsed.data.booking_id)
    .maybeSingle();

  if (bookingErr || !booking) {
    return { errors: { _form: "Booking not found" }, values: raw };
  }

  // Sanity-check the contacts are ours + active.
  const { data: contacts, error: contactsErr } = await supabase
    .from("freelancer_contacts")
    .select("id, full_name, phone, active")
    .in("id", contactIds);

  if (contactsErr || !contacts || contacts.length === 0) {
    return { errors: { _form: "No contacts matched" }, values: raw };
  }

  const activeContacts = contacts.filter((c) => c.active);
  if (activeContacts.length === 0) {
    return {
      errors: { contact_ids: "All selected contacts are inactive" },
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

  // 2. Insert one dispatch per contact (queued status).
  const dispatchesToInsert = activeContacts.map((c) => ({
    organization_id: membership.organization_id,
    offer_id: offer.id,
    contact_id: c.id,
    claim_token: generateClaimToken(),
    delivery_status: "queued",
  }));

  const { data: dispatches, error: dispErr } = await supabase
    .from("job_offer_dispatches")
    .insert(dispatchesToInsert)
    .select("id, contact_id, claim_token");

  if (dispErr || !dispatches) {
    return {
      errors: { _form: dispErr?.message ?? "Could not create dispatches" },
      values: raw,
    };
  }

  // 3. For each dispatch, compose and send the SMS, then update the row.
  const base = claimBaseUrl();
  const addressShort = shortAddress(booking.address);

  for (const d of dispatches) {
    const contact = activeContacts.find((c) => c.id === d.contact_id);
    if (!contact) continue;

    const body = composeOfferSms({
      serviceType: booking.service_type,
      scheduledAt: booking.scheduled_at,
      durationMinutes: booking.duration_minutes,
      payCents: parsed.data.pay_dollars,
      addressShort,
      claimUrl: `${base}/claim/${d.claim_token}`,
      positionsNeeded: parsed.data.positions_needed,
    });

    const result = await sendSms(contact.phone, body);

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

  // 4. Stamp last_offered_at on every dispatched contact.
  await supabase
    .from("freelancer_contacts")
    .update({ last_offered_at: new Date().toISOString() })
    .in(
      "id",
      activeContacts.map((c) => c.id),
    );

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
