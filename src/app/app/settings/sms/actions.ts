"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canCreateData } from "@/lib/subscription";
import { provisionOrgNumber } from "@/lib/twilio-provision";
import { ensureSmsOverageItem, removeSmsOverageItem } from "@/lib/stripe";

export type SmsSettingsFormState = {
  errors?: Partial<Record<"_form" | "cap", string>>;
  success?: boolean;
};

function assertOwnerAdmin(role: string): string | null {
  return ["owner", "admin"].includes(role) ? null : "You don't have permission.";
}

/**
 * Turn SMS on: provision the org's own number, attach the metered overage item
 * (paid orgs only), and flip the master switch. Gated on an active/comped
 * subscription — SMS spends money, so a lapsed org can't enable it.
 */
export async function enableSmsAction(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState signature
  _prev: SmsSettingsFormState,
): Promise<SmsSettingsFormState> {
  const { membership } = await getActionContext();
  const permErr = assertOwnerAdmin(membership.role);
  if (permErr) return { errors: { _form: permErr } };

  const orgId = membership.organization_id;

  if (!(await canCreateData(orgId))) {
    return {
      errors: {
        _form:
          "Your subscription is inactive. Start or renew a plan in Billing before enabling SMS.",
      },
    };
  }

  const provision = await provisionOrgNumber(orgId);
  if (!provision.ok) {
    return {
      errors: {
        _form: `Couldn't provision a number: ${provision.error}`,
      },
    };
  }

  // Attach the metered overage item (best-effort; comped/no-Stripe orgs get null).
  try {
    await ensureSmsOverageItem(orgId);
  } catch (err) {
    console.error("[sms-settings] ensureSmsOverageItem failed:", err);
  }

  const admin = createSupabaseAdminClient();

  // Turn ON the SMS automations too. They default OFF, so flipping only the
  // master switch would send nothing — a classic "I enabled SMS but no texts
  // go out" trap. Merge into existing automation_settings so other toggles are
  // preserved; the owner can still turn individual ones back off.
  const { data: settingsRow } = (await admin
    .from("organizations")
    .select("automation_settings")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { automation_settings: Record<string, unknown> | null } | null;
  };
  const automation_settings: Record<string, unknown> = {
    ...(settingsRow?.automation_settings ?? {}),
  };
  for (const key of [
    "booking_confirmation_sms",
    "booking_reminder_client_sms",
    "booking_assignment_sms",
  ]) {
    automation_settings[key] = {
      ...(automation_settings[key] as Record<string, unknown> | undefined),
      enabled: true,
    };
  }

  const { error } = await admin
    .from("organizations")
    .update({ sms_enabled: true, automation_settings } as never)
    .eq("id", orgId);
  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: orgId,
    after: { sms_enabled: true, sms_from_number: provision.number },
  });

  revalidatePath("/app/settings/sms");
  return { success: true };
}

/**
 * Turn SMS off: flip the master switch and detach the metered overage item so
 * no further usage is billed. The number is KEPT (so re-enabling preserves the
 * org's identity); release it manually from Twilio if you want to stop the
 * monthly rental.
 */
export async function disableSmsAction(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState signature
  _prev: SmsSettingsFormState,
): Promise<SmsSettingsFormState> {
  const { membership } = await getActionContext();
  const permErr = assertOwnerAdmin(membership.role);
  if (permErr) return { errors: { _form: permErr } };

  const orgId = membership.organization_id;

  try {
    await removeSmsOverageItem(orgId);
  } catch (err) {
    console.error("[sms-settings] removeSmsOverageItem failed:", err);
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ sms_enabled: false } as never)
    .eq("id", orgId);
  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: orgId,
    after: { sms_enabled: false },
  });

  revalidatePath("/app/settings/sms");
  return { success: true };
}

/** Update the hard monthly overage cap (dollars in the form → cents stored). */
export async function saveCapAction(
  _prev: SmsSettingsFormState,
  formData: FormData,
): Promise<SmsSettingsFormState> {
  const { membership } = await getActionContext();
  const permErr = assertOwnerAdmin(membership.role);
  if (permErr) return { errors: { _form: permErr } };

  const raw = String(formData.get("cap_dollars") ?? "").trim();
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100000) {
    return { errors: { cap: "Enter a dollar amount between 0 and 100,000." } };
  }
  const cents = Math.round(dollars * 100);

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ sms_overage_cap_cents: cents } as never)
    .eq("id", membership.organization_id);
  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { sms_overage_cap_cents: cents },
  });

  revalidatePath("/app/settings/sms");
  return { success: true };
}
