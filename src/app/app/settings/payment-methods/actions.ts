"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maybeRedirectToSetup } from "@/lib/setup-return";
import { noCardNumber, CARD_DETECTED_MESSAGE } from "@/lib/card-detection";
import { encryptField } from "@/lib/field-encryption";

// Hard cap so we don't let someone paste War and Peace into a public page.
//
// PCI guard: this field is rendered on the PUBLIC client-facing invoice
// page. If a card number landed here it would be exposed to anyone with
// the invoice link. Reject any Luhn-validated PAN before persisting.
// "Visa ending in 4242" and similar last-four strings pass through.
const PaymentInstructionsSchema = z.object({
  instructions: z
    .string()
    .trim()
    .max(4000, "Keep it under 4000 characters")
    .refine(noCardNumber, { message: CARD_DETECTED_MESSAGE })
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

type Field = keyof typeof PaymentInstructionsSchema.shape;
export type PaymentMethodsFormState = ActionState<Field>;

export async function savePaymentInstructionsAction(
  _prev: PaymentMethodsFormState,
  formData: FormData,
): Promise<PaymentMethodsFormState> {
  const raw = {
    instructions: String(formData.get("instructions") ?? ""),
  };

  const parsed = parseForm(PaymentInstructionsSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return {
      errors: { _form: "You don't have permission to change payment settings." },
      values: raw,
    };
  }

  const { data: prev } = await supabase
    .from("organizations")
    .select("default_payment_instructions")
    .eq("id", membership.organization_id)
    .maybeSingle();

  // Use the service-role client for the update. RLS on organizations
  // permits UPDATE only for role='owner', so an admin's save would
  // silently land on zero rows with no error. Since this action already
  // gates on owner+admin above, it's safe to bypass RLS here.
  const admin = createSupabaseAdminClient();
  // Encrypt at rest. Read sites (the edit form here and the public
  // invoice page at /i/[token]) call maybeDecryptField() to render
  // plaintext. Legacy rows written before this change are still
  // readable — maybeDecryptField passes non-v1: values through unchanged.
  const encryptedInstructions = encryptField(parsed.data.instructions);
  const { error } = await admin
    .from("organizations")
    .update({ default_payment_instructions: encryptedInstructions })
    .eq("id", membership.organization_id);

  if (error) return { errors: { _form: error.message }, values: raw };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    before: { default_payment_instructions: prev?.default_payment_instructions ?? null },
    after: { default_payment_instructions: parsed.data.instructions },
  });

  revalidatePath("/app/settings/payment-methods");
  revalidatePath("/app");

  // Bounce back to /app/setup when user came from onboarding.
  maybeRedirectToSetup(formData);

  return { values: raw };
}

export type TipInstructionsState = {
  errors?: Partial<Record<"_form" | "instructions", string>>;
  success?: boolean;
};

/**
 * The public wording that invites a tip from someone paying WITHOUT a card.
 *
 * Lives beside payment instructions because that's what it is: text a client
 * reads on the invoice when working out how to pay. A bank transfer has no
 * checkout to hang a tip picker on, and at this client 21 of 23 payments
 * arrive that way — so words are the only lever that channel has.
 *
 * Writes into the same tipping_settings JSONB the Invoicing screen owns, and
 * MERGES rather than overwrites, or saving here would switch tipping off.
 */
export async function saveTipInstructionsAction(
  _prev: TipInstructionsState,
  formData: FormData,
): Promise<TipInstructionsState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }

  const { mergeTippingSettings, normalizeTipInstructions } = await import(
    "@/lib/tip-split"
  );
  const instructions = normalizeTipInstructions(formData.get("instructions"));

  const admin = createSupabaseAdminClient();
  const { data: current } = (await admin
    .from("organizations")
    .select("tipping_settings")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { tipping_settings: unknown } | null;
  };

  const settings = mergeTippingSettings(current?.tipping_settings, {
    instructions,
  });

  const { error } = await admin
    .from("organizations")
    .update({ tipping_settings: settings } as never)
    .eq("id", membership.organization_id);
  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { tipping_instructions: instructions },
  });

  revalidatePath("/app/settings/payment-methods");
  return { success: true };
}
