"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { ClientSchema } from "@/lib/validators/clients";
import { redirectAfterSetup } from "@/lib/setup-return";
import { normalizePhone } from "@/lib/phone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Field = keyof typeof ClientSchema.shape;
export type ClientFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    // Normalise to E.164 on the way in — Twilio requires this format and
    // the opt-in gate in sendOrgSms matches by stored phone number.
    phone: normalizePhone(String(formData.get("phone") ?? "")),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    preferred_contact: String(formData.get("preferred_contact") ?? "email"),
    preferred_cleaner_id: String(formData.get("preferred_cleaner_id") ?? ""),
    billing_cadence: String(formData.get("billing_cadence") ?? "on_demand"),
    billing_type: String(formData.get("billing_type") ?? "itemized"),
    referred_by_client_id: String(formData.get("referred_by_client_id") ?? ""),
    // Form input is in dollars (user-facing); convert to cents for storage.
    flat_rate_cents: (() => {
      const raw = String(formData.get("flat_rate_cents") ?? "").trim();
      if (!raw) return "";
      const dollars = parseFloat(raw);
      if (isNaN(dollars) || dollars < 0) return "";
      return String(Math.round(dollars * 100));
    })(),
  };
}

/**
 * Insert a persistent "say thank you" notification when a referral is recorded.
 * Runs fire-and-forget — a delivery failure must never block the client save.
 * Uses the admin client because notifications INSERT is service-role-only.
 */
async function notifyReferralThankYou(
  organizationId: string,
  referrerId: string,
  newClientName: string,
) {
  try {
    const admin = createSupabaseAdminClient();

    // Resolve the referrer's display name.
    const { data: referrer } = (await admin
      .from("clients")
      .select("name")
      .eq("id", referrerId)
      .eq("organization_id" as never, organizationId as never)
      .maybeSingle()) as unknown as { data: { name: string } | null };

    const referrerName = referrer?.name ?? "the referring client";

    await admin.from("notifications" as never).insert({
      organization_id: organizationId,
      // null recipient = visible to every admin/manager in the org
      recipient_membership_id: null,
      type: "general",
      title: `Say thank you to ${referrerName}!`,
      body: `${newClientName} was referred by ${referrerName}. A quick thank-you message goes a long way.`,
      href: `/app/clients/${referrerId}`,
    } as never);
  } catch {
    // Non-critical — log silently and let the client save succeed.
    console.error("[referral] Failed to insert thank-you notification");
  }
}

export async function createClientAction(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ClientSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Checkbox sends "on" when checked, nothing when unchecked.
  const smsOptedIn = formData.get("sms_opted_in") === "on";

  const { data: inserted, error } = (await supabase
    .from("clients")
    .insert({
      organization_id: membership.organization_id,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
      preferred_cleaner_id: parsed.data.preferred_cleaner_id ?? null,
      sms_opted_in: smsOptedIn,
      billing_cadence: parsed.data.billing_cadence,
      billing_type: parsed.data.billing_type,
      flat_rate_cents: parsed.data.flat_rate_cents ?? null,
      referred_by_client_id: parsed.data.referred_by_client_id ?? null,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error || !inserted) {
    return { errors: { _form: error?.message ?? "Insert failed" }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    entity_id: inserted.id,
    after: { name: parsed.data.name, email: parsed.data.email ?? null },
  });

  // Fire-and-forget: remind the org to thank the referring client.
  if (parsed.data.referred_by_client_id) {
    notifyReferralThankYou(
      membership.organization_id,
      parsed.data.referred_by_client_id,
      parsed.data.name,
    );
  }

  revalidatePath("/app/clients");
  revalidatePath("/app");
  redirectAfterSetup(formData, "/app/clients");
}

export async function updateClientAction(
  id: string,
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ClientSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // A client cannot refer themselves — catch both crafted form POSTs and
  // UI bugs before they create a circular self-referral in the DB.
  if (parsed.data.referred_by_client_id && parsed.data.referred_by_client_id === id) {
    return { errors: { _form: "A client cannot be their own referrer." }, values: raw };
  }

  const { data: previous } = (await supabase
    .from("clients")
    .select(
      "name, email, phone, address, notes, preferred_contact, preferred_cleaner_id, referred_by_client_id",
    )
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: {
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      notes: string | null;
      preferred_contact: string;
      preferred_cleaner_id: string | null;
      referred_by_client_id: string | null;
    } | null;
  };

  const smsOptedIn = formData.get("sms_opted_in") === "on";

  const { error } = await (supabase
    .from("clients")
    .update({
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
      preferred_cleaner_id: parsed.data.preferred_cleaner_id ?? null,
      sms_opted_in: smsOptedIn,
      billing_cadence: parsed.data.billing_cadence,
      billing_type: parsed.data.billing_type,
      flat_rate_cents: parsed.data.flat_rate_cents ?? null,
      referred_by_client_id: parsed.data.referred_by_client_id ?? null,
    } as never)
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) {
    return { errors: { _form: error.message }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    before: previous ?? null,
    after: {
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
      sms_opted_in: smsOptedIn,
    },
  });

  // Fire-and-forget: notify only when a referrer is newly added or swapped.
  const newReferrerId = parsed.data.referred_by_client_id ?? null;
  const oldReferrerId = previous?.referred_by_client_id ?? null;
  if (newReferrerId && newReferrerId !== oldReferrerId) {
    notifyReferralThankYou(
      membership.organization_id,
      newReferrerId,
      parsed.data.name,
    );
  }

  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/clients");
}

export async function deleteClientAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  const { data: previous } = await supabase
    .from("clients")
    .select("name, email")
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle();

  const { error } = await supabase.from("clients").delete().eq("id", id).eq("organization_id", membership.organization_id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "client",
    entity_id: id,
    before: previous ?? null,
  });

  revalidatePath("/app/clients");
  revalidatePath("/app");
  redirect("/app/clients");
}
