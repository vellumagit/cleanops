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
    return { errors: { _form: "You don't have permission to invite team members." }, values: raw };
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
      role: parsed.data.role as "admin" | "employee",
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

  // TODO: When Resend is wired up, send the invite email here.
  // For now, the admin copies the link from the invitations list.

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

  const { error } = await supabase.from("invitations").delete().eq("id", id);
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
  role: z.enum(["owner", "admin", "employee"]).optional(),
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
