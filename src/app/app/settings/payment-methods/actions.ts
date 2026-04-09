"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";

// Hard cap so we don't let someone paste War and Peace into a public page.
const PaymentInstructionsSchema = z.object({
  instructions: z
    .string()
    .trim()
    .max(4000, "Keep it under 4000 characters")
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

  const { data: prev } = await supabase
    .from("organizations")
    .select("default_payment_instructions")
    .eq("id", membership.organization_id)
    .maybeSingle();

  const { error } = await supabase
    .from("organizations")
    .update({ default_payment_instructions: parsed.data.instructions })
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
  return { values: raw };
}
