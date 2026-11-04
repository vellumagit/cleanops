"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canCreateData } from "@/lib/subscription";
import { logAuditEvent } from "@/lib/audit";
import {
  EMPTY_INPUT,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationInput,
} from "@/lib/sms-registration-rules";
import {
  advanceUsRegistration,
  detailsFromInput,
  inputFromDetails,
  submitUsRegistration,
} from "@/lib/twilio-a2p";

export type RegistrationFormState = {
  errors?: RegistrationErrors;
  saved?: boolean;
  submitted?: boolean;
};

/**
 * Save the US texting registration, and submit it to the carriers when the
 * owner presses Submit. Saving alone is free; submitting registers a brand,
 * which Twilio charges for, so it's a separate, deliberate button.
 *
 * The EIN is never sent back to the browser. Left blank on a later save,
 * the one already on file is kept.
 */
export async function saveRegistrationAction(
  _prev: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "Only an owner or admin can register the business for texting." } };
  }
  const orgId = membership.organization_id;
  const submit = formData.get("intent") === "submit";

  const db = createSupabaseAdminClient();
  const { data: existing } = (await db
    .from("sms_registrations" as never)
    .select("status, details")
    .eq("organization_id" as never, orgId as never)
    .maybeSingle()) as unknown as {
    data: { status: string; details: Record<string, string> } | null;
  };
  if (existing && !["draft", "needs_changes"].includes(existing.status)) {
    return { errors: { _form: "This registration is with the carriers now. It can be changed if they ask for changes." } };
  }

  const raw: Partial<RegistrationInput> = {};
  for (const k of Object.keys(EMPTY_INPUT) as (keyof RegistrationInput)[]) {
    raw[k] = String(formData.get(k) ?? "");
  }
  if (!raw.ein && existing?.details?.ein_enc) {
    raw.ein = inputFromDetails(existing.details).ein;
  }

  const checked = validateRegistration(raw);
  if (!checked.ok) return { errors: checked.errors };

  if (submit && !(await canCreateData(orgId))) {
    return { errors: { _form: "Your subscription is inactive. Start or renew a plan in Billing first." } };
  }

  const { error } = await db.from("sms_registrations" as never).upsert(
    {
      organization_id: orgId,
      country: "US",
      details: detailsFromInput(checked.input),
      updated_at: new Date().toISOString(),
      ...(existing ? {} : { status: "draft" }),
    } as never,
    { onConflict: "organization_id" },
  );
  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: orgId,
    after: { sms_registration: submit ? "submit" : "saved", legal_name: checked.input.legal_name },
  });

  if (submit) {
    const r = await submitUsRegistration(orgId);
    revalidatePath("/app/settings/sms");
    if (!r.ok) return { errors: { _form: r.error } };
    return { submitted: true };
  }

  revalidatePath("/app/settings/sms");
  return { saved: true };
}

/** "Check now": ask Twilio where the registration has got to. */
export async function checkRegistrationAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return { ok: false, error: "Not allowed." };
  await advanceUsRegistration(membership.organization_id);
  revalidatePath("/app/settings/sms");
  return { ok: true };
}
