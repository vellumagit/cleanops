"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canCreateData } from "@/lib/subscription";
import { provisionOrgNumber } from "@/lib/twilio-provision";
import { removeSmsOverageItem } from "@/lib/stripe";
import { turnOnOrgSms } from "@/lib/sms-enable";

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

  // A US business can't text from a bare number: carriers block it until
  // the business is registered (the registration below on this page). The
  // number is bought when that's approved, not here.
  {
    const admin = createSupabaseAdminClient();
    const { data: org } = (await admin
      .from("organizations")
      .select("holiday_region, timezone")
      .eq("id", orgId)
      .maybeSingle()) as unknown as {
      data: { holiday_region: string | null; timezone: string | null } | null;
    };
    const { smsCountryFor } = await import("@/lib/sms-registration-rules");
    if (org && smsCountryFor(org) === "US") {
      const { data: reg } = (await admin
        .from("sms_registrations" as never)
        .select("status")
        .eq("organization_id" as never, orgId as never)
        .maybeSingle()) as unknown as { data: { status: string } | null };
      const { data: num } = (await admin
        .from("organizations")
        .select("sms_from_number")
        .eq("id", orgId)
        .maybeSingle()) as unknown as { data: { sms_from_number: string | null } | null };
      if (reg?.status === "approved" && num?.sms_from_number) {
        const on = await turnOnOrgSms(orgId);
        if (!on.ok) return { errors: { _form: on.error } };
        await logAuditEvent({
          membership,
          action: "update",
          entity: "settings",
          entity_id: orgId,
          after: { sms_enabled: true, sms_from_number: num.sms_from_number },
        });
        revalidatePath("/app/settings/sms");
        return { success: true };
      }
      return {
        errors: {
          _form:
            "US businesses register with the carriers before texting. Fill in the registration below; texting turns on by itself once it's approved.",
        },
      };
    }
  }

  const provision = await provisionOrgNumber(orgId);
  if (!provision.ok) {
    return {
      errors: {
        _form: `Couldn't provision a number: ${provision.error}`,
      },
    };
  }

  const on = await turnOnOrgSms(orgId);
  if (!on.ok) return { errors: { _form: on.error } };

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
