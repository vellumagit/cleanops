"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { InvitationSchema } from "@/lib/validators/invitations";

type Field = "email" | "role" | "pay_rate";
export type InviteFormState = ActionState<Field>;

/* ------------------------------------------------------------------ */
/*  Send invitation                                                    */
/* ------------------------------------------------------------------ */

export async function sendInvitationAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const raw = {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    role: String(formData.get("role") ?? "employee"),
    pay_rate: String(formData.get("pay_rate") ?? ""),
  };

  const parsed = parseForm(InvitationSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Only owners and admins can invite
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don\u0027t have permission to invite team members." }, values: raw };
  }

  // Check if this email already has an active membership in this org
  const admin = createSupabaseAdminClient();
  const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existingUser = existingUsers?.users.find(
    (u) => u.email?.toLowerCase() === parsed.data.email.toLowerCase(),
  );

  if (existingUser) {
    const { data: existingMembership } = await supabase
      .from("memberships")
      .select("id, status")
      .eq("organization_id", membership.organization_id)
      .eq("profile_id", existingUser.id)
      .maybeSingle();

    if (existingMembership) {
      if (existingMembership.status === "active") {
        return { errors: { email: "This person is already a member of your team." }, values: raw };
      }
      if (existingMembership.status === "disabled") {
        return { errors: { email: "This person was previously removed. Re-activate them from Settings → Members." }, values: raw };
      }
    }
  }

  // Check for an existing pending invitation
  const { data: existingInvite } = await supabase
    .from("invitations")
    .select("id, accepted_at")
    .eq("organization_id", membership.organization_id)
    .eq("email", parsed.data.email)
    .is("accepted_at", null)
    .maybeSingle();

  if (existingInvite) {
    return { errors: { email: "An invitation is already pending for this email." }, values: raw };
  }

  // Create the invitation
  const { data: invitation, error } = await supabase
    .from("invitations")
    .insert({
      organization_id: membership.organization_id,
      email: parsed.data.email,
      role: parsed.data.role as "admin" | "manager" | "employee",
      invited_by: membership.profile_id,
    })
    .select("id, token")
    .single();

  if (error || !invitation) {
    return { errors: { _form: error?.message ?? "Could not create invitation." }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "invite",
    entity: "membership",
    entity_id: invitation.id,
    after: {
      email: parsed.data.email,
      role: parsed.data.role,
      pay_rate_cents: parsed.data.pay_rate ?? null,
    },
  });

  // Send the invite email (fire-and-forget)
  {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const { sendOrgEmail } = await import("@/lib/email");
    const { teamInviteEmail } = await import("@/lib/email-templates");

    // Fetch branding
    const { data: orgData } = await supabase
      .from("organizations")
      .select("name, brand_color")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as {
      data: { name: string; brand_color: string | null } | null;
    };

    const template = teamInviteEmail({
      orgName: orgData?.name ?? membership.organization_name,
      role: parsed.data.role,
      signupUrl: `${siteUrl}/signup?invite=${invitation.token}`,
      brandColor: orgData?.brand_color ?? undefined,
    });

    sendOrgEmail(membership.organization_id, {
      to: parsed.data.email,
      ...template,
    });
  }

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");

  // Return the token so the UI can show the invite link
  return {
    values: { ...raw, _token: invitation.token },
  };
}

/* ------------------------------------------------------------------ */
/*  Revoke (delete) a pending invitation                               */
/* ------------------------------------------------------------------ */

export async function revokeInvitationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  const { data: invitation } = await supabase
    .from("invitations")
    .select("id, email, role")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("invitations").delete().eq("id", id).eq("organization_id", membership.organization_id);
  if (error) throw error;

  if (invitation) {
    await logAuditEvent({
      membership,
      action: "delete",
      entity: "membership",
      entity_id: id,
      before: { email: invitation.email, role: invitation.role, type: "invitation" },
    });
  }

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");
}

/* ------------------------------------------------------------------ */
/*  Update membership (role, status, pay rate)                         */
/* ------------------------------------------------------------------ */

const UpdateMemberSchema = z.object({
  role: z.enum(["owner", "admin", "manager", "employee"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  pay_rate: z
    .string()
    .transform((s) => {
      if (!s || s.trim() === "") return null;
      const cleaned = s.replace(/[$,\s]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n) || n < 0) return null;
      return Math.round(n * 100);
    })
    .optional(),
});

export type UpdateMemberState = {
  errors?: Partial<Record<"role" | "status" | "pay_rate" | "_form", string>>;
  done?: boolean;
};

export async function updateMemberAction(
  memberId: string,
  _prev: UpdateMemberState,
  formData: FormData,
): Promise<UpdateMemberState> {
  const raw = {
    role: String(formData.get("role") ?? ""),
    status: String(formData.get("status") ?? ""),
    pay_rate: String(formData.get("pay_rate") ?? ""),
  };

  const parsed = UpdateMemberSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "_form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { errors };
  }

  const { membership, supabase } = await getActionContext();

  // Only owners can change other owners; admins can manage employees
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission to manage members." } };
  }

  // Prevent self-demotion of the last owner
  if (parsed.data.role && parsed.data.role !== "owner") {
    const { data: target } = await supabase
      .from("memberships")
      .select("role")
      .eq("id", memberId)
      .single();

    if (target?.role === "owner") {
      const { count } = await supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id)
        .eq("role", "owner")
        .eq("status", "active");

      if ((count ?? 0) <= 1) {
        return { errors: { _form: "Cannot demote the last owner. Promote someone else first." } };
      }
    }
  }

  // Get previous state for audit
  const { data: before } = await supabase
    .from("memberships")
    .select("role, status, pay_rate_cents")
    .eq("id", memberId)
    .single();

  const updatePayload: Record<string, unknown> = {};
  if (parsed.data.role) updatePayload.role = parsed.data.role;
  if (parsed.data.status) updatePayload.status = parsed.data.status;
  if (parsed.data.pay_rate !== undefined) updatePayload.pay_rate_cents = parsed.data.pay_rate;

  if (Object.keys(updatePayload).length === 0) {
    return { errors: { _form: "Nothing to update." } };
  }

  const { error } = await supabase
    .from("memberships")
    .update(updatePayload)
    .eq("id", memberId);

  if (error) {
    return { errors: { _form: error.message } };
  }

  const action = parsed.data.status === "disabled" ? "deactivate" : "update";

  await logAuditEvent({
    membership,
    action,
    entity: "membership",
    entity_id: memberId,
    before: before ?? null,
    after: updatePayload,
  });

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");

  return { done: true };
}

/* ------------------------------------------------------------------ */
/*  Create a shadow employee (no invite, no login)                     */
/*                                                                     */
/*  For family members / subs / anyone who does the work but doesn't   */
/*  need app access. The row has NULL profile_id, so no auth path      */
/*  exists — they simply appear as a selectable employee across the    */
/*  app (bookings, timesheets, payroll) with their display_name.       */
/* ------------------------------------------------------------------ */

export type ManualEmployeeFormState = {
  errors?: Partial<Record<
    "display_name" | "role" | "pay_rate" | "contact_email" | "contact_phone" | "_form",
    string
  >>;
  values?: {
    display_name?: string;
    role?: string;
    pay_rate?: string;
    contact_email?: string;
    contact_phone?: string;
  };
  done?: boolean;
};

const ManualEmployeeSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Keep the name under 120 characters"),
  role: z.enum(["employee", "manager", "admin"]).catch("employee"),
  pay_rate_cents: z
    .string()
    .trim()
    .optional()
    .transform((s) => {
      if (!s) return null;
      const n = Number(s.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) return null;
      return Math.round(n * 100);
    }),
  contact_email: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s.toLowerCase() : null))
    .refine(
      (s) => s === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
      "Enter a valid email address or leave blank",
    ),
  contact_phone: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : null)),
});

export async function createManualEmployeeAction(
  _prev: ManualEmployeeFormState,
  formData: FormData,
): Promise<ManualEmployeeFormState> {
  const raw = {
    display_name: String(formData.get("display_name") ?? ""),
    role: String(formData.get("role") ?? "employee"),
    pay_rate: String(formData.get("pay_rate") ?? ""),
    contact_email: String(formData.get("contact_email") ?? ""),
    contact_phone: String(formData.get("contact_phone") ?? ""),
  };

  const parsed = ManualEmployeeSchema.safeParse({
    display_name: raw.display_name,
    role: raw.role,
    pay_rate_cents: raw.pay_rate,
    contact_email: raw.contact_email,
    contact_phone: raw.contact_phone,
  });

  if (!parsed.success) {
    const errors: ManualEmployeeFormState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<
        ManualEmployeeFormState["errors"]
      >;
      // Normalize zod's field name back to the form field name.
      const mapped = key === ("pay_rate_cents" as never) ? "pay_rate" : key;
      if (!errors[mapped]) errors[mapped] = issue.message;
    }
    return { errors, values: raw };
  }

  const { membership } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return {
      errors: { _form: "Only owners and admins can add employees." },
      values: raw,
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: inserted, error } = (await admin
    .from("memberships")
    .insert({
      organization_id: membership.organization_id,
      profile_id: null,
      role: parsed.data.role,
      status: "active",
      pay_rate_cents: parsed.data.pay_rate_cents,
      display_name: parsed.data.display_name,
      contact_email: parsed.data.contact_email,
      contact_phone: parsed.data.contact_phone,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error || !inserted) {
    return {
      errors: { _form: error?.message ?? "Could not add employee." },
      values: raw,
    };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "membership",
    entity_id: inserted.id,
    after: {
      display_name: parsed.data.display_name,
      role: parsed.data.role,
      pay_rate_cents: parsed.data.pay_rate_cents,
      manual: true,
    },
  });

  revalidatePath("/app/employees");
  revalidatePath("/app/timesheets");
  revalidatePath("/app/payroll");

  return { done: true };
}
