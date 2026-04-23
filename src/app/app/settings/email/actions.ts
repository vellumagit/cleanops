"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { senderVerificationEmail } from "@/lib/email-templates";

export type SenderEmailFormState = {
  errors?: Partial<Record<"sender_email" | "_form", string>>;
  success?: boolean;
};

export type ContactInfoFormState = {
  errors?: Partial<Record<"contact_email" | "contact_phone" | "_form", string>>;
  success?: boolean;
};

const FREEMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "yahoo.ca",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "mail.com",
  "protonmail.com",
];

export async function saveSenderEmailAction(
  _prev: SenderEmailFormState,
  formData: FormData,
): Promise<SenderEmailFormState> {
  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }

  const raw = String(formData.get("sender_email") ?? "").trim().toLowerCase();

  if (!raw) {
    // Clear the sender email
    const admin = createSupabaseAdminClient();
    await admin
      .from("organizations")
      .update({
        sender_email: null,
        sender_email_verified_at: null,
        sender_email_token: null,
      } as never)
      .eq("id", membership.organization_id);

    revalidatePath("/app/settings/email");
    return { success: true };
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { errors: { sender_email: "Enter a valid email address." } };
  }

  // Block freemail
  const domain = raw.split("@")[1];
  if (FREEMAIL_DOMAINS.includes(domain)) {
    return {
      errors: {
        sender_email:
          "Use a business domain email (not Gmail, Yahoo, etc). This ensures deliverability.",
      },
    };
  }

  // Generate verification token
  const token = crypto.randomBytes(32).toString("base64url");

  const admin = createSupabaseAdminClient();
  await admin
    .from("organizations")
    .update({
      sender_email: raw,
      sender_email_verified_at: null,
      sender_email_token: token,
    } as never)
    .eq("id", membership.organization_id);

  // Fetch org name + brand for email template
  const { data: org } = await supabase
    .from("organizations")
    .select("name, brand_color")
    .eq("id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: { name: string; brand_color: string | null } | null;
  };

  // Send verification email
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const verifyUrl = `${siteUrl}/api/verify-sender?token=${token}&org=${membership.organization_id}`;
  const template = senderVerificationEmail({
    orgName: org?.name ?? "your organization",
    verifyUrl,
    brandColor: org?.brand_color ?? undefined,
  });

  await sendEmail({
    to: raw,
    ...template,
  });

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { sender_email: raw, verification_sent: true },
  });

  revalidatePath("/app/settings/email");
  return { success: true };
}

/**
 * Save the public contact email + phone the client sees on invoices.
 * Separate from sender_email — this one doesn't need verification
 * because we never put it in the From header (only Reply-To and the
 * public invoice page body). The client uses it to actually reach the
 * business.
 */
export async function saveContactInfoAction(
  _prev: ContactInfoFormState,
  formData: FormData,
): Promise<ContactInfoFormState> {
  const { membership } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }

  const rawEmail = String(formData.get("contact_email") ?? "").trim();
  const rawPhone = String(formData.get("contact_phone") ?? "").trim();

  // Email is optional — leave empty to clear. If present, must look
  // like an email (no freemail block here; clients asking questions
  // can reply to the owner's Gmail without issue).
  const email = rawEmail.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      errors: { contact_email: "Enter a valid email address." },
    };
  }

  // Phone is free-form — we don't enforce E.164 because owners often
  // want "(555) 123-4567" or "+1 555 123 4567" depending on region.
  // Loose sanity: at least 7 digits somewhere.
  if (rawPhone && !/\d{7,}/.test(rawPhone.replace(/\D/g, ""))) {
    return {
      errors: { contact_phone: "Enter a valid phone number." },
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      contact_email: email || null,
      contact_phone: rawPhone || null,
    } as never)
    .eq("id", membership.organization_id);

  if (error) return { errors: { _form: error.message } };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: { contact_email: email || null, contact_phone: rawPhone || null },
  });

  revalidatePath("/app/settings/email");
  return { success: true };
}
