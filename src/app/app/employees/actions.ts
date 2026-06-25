"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { InvitationSchema } from "@/lib/validators/invitations";

type Field = "name" | "email" | "role" | "pay_rate";
export type InviteFormState = ActionState<Field>;

/* ------------------------------------------------------------------ */
/*  Send invitation                                                    */
/* ------------------------------------------------------------------ */

export async function sendInvitationAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const raw = {
    name: String(formData.get("name") ?? "").trim(),
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

  // Send the invite email — AWAITED so we can surface delivery failures
  // to the UI instead of silently leaving the owner thinking the email
  // went out. pauseExempt:true bypasses the CLIENT_EMAILS_PAUSED platform
  // kill switch — invitations are operational, not marketing, and getting
  // caught by that switch was the root cause of "she invited an employee
  // and they never got the email".
  let emailDelivered = false;
  let emailError: string | null = null;
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const { sendOrgEmailDetailed } = await import("@/lib/email");
    const { teamInviteEmail } = await import("@/lib/email-templates");

    // Fetch branding
    const { data: orgData } = await supabase
      .from("organizations")
      .select("name, brand_color")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as {
      data: { name: string; brand_color: string | null } | null;
    };

    // If the person already has a Sollos account, send them to /login
    // so they sign in with their existing credentials and then accept.
    // New users go to /signup to create their account first.
    const acceptPath = existingUser
      ? `/login?invite=${invitation.token}`
      : `/signup?invite=${invitation.token}`;

    const template = teamInviteEmail({
      orgName: orgData?.name ?? membership.organization_name,
      inviteeName: parsed.data.name,
      role: parsed.data.role,
      signupUrl: `${siteUrl}${acceptPath}`,
      brandColor: orgData?.brand_color ?? undefined,
    });

    const result = await sendOrgEmailDetailed(membership.organization_id, {
      to: parsed.data.email,
      pauseExempt: true,
      ...template,
    });
    emailDelivered = result.ok;
    if (!result.ok) {
      emailError = result.reason;
      console.error(
        "[invite] email delivery failed:",
        parsed.data.email,
        result.reason,
      );
    }
  } catch (err) {
    emailError = err instanceof Error ? err.message : "Unknown email error.";
    console.error("[invite] email send threw:", err);
  }

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");

  // Return the token + email delivery status so the UI can show the
  // owner whether the email went out or whether they need to copy the
  // link manually.
  return {
    values: {
      ...raw,
      _token: invitation.token,
      _emailSent: emailDelivered ? "1" : "",
      _emailError: emailError ?? "",
    },
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

// Preprocess "" → undefined before piping into the enum. Essential for
// fields that are conditionally hidden in the form — a hidden field
// doesn't submit a value (formData.get returns null, which we coerce
// to "" at read time), and without this preprocessor the enum would
// reject "" as "not a valid value" and the whole update would silently
// fail validation.
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

const UpdateMemberSchema = z.object({
  role: emptyToUndefined(
    z.enum(["owner", "admin", "manager", "employee"]).optional(),
  ),
  status: emptyToUndefined(z.enum(["active", "disabled"]).optional()),
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
  // display_name applies to ALL employees now.
  // For shadow members it's their only name source.
  // For invited members it becomes an admin-controlled override that takes
  // precedence in memberDisplayName() — the employee's login profile name
  // is untouched so they don't notice a change from their end.
  display_name: z
    .string()
    .trim()
    .max(120, "Keep the name under 120 characters")
    .optional(),
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
  address: z
    .string()
    .trim()
    .max(300, "Keep the address under 300 characters")
    .optional()
    .transform((s) => (s && s.length > 0 ? s : null)),
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2000 characters")
    .optional()
    .transform((s) => (s && s.length > 0 ? s : null)),
  accommodations: z
    .string()
    .trim()
    .max(2000, "Keep this under 2000 characters")
    .optional()
    .transform((s) => (s && s.length > 0 ? s : null)),
});

export type UpdateMemberState = {
  errors?: Partial<
    Record<
      | "role"
      | "status"
      | "pay_rate"
      | "display_name"
      | "contact_email"
      | "contact_phone"
      | "address"
      | "notes"
      | "accommodations"
      | "_form",
      string
    >
  >;
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
    display_name: String(formData.get("display_name") ?? ""),
    contact_email: String(formData.get("contact_email") ?? ""),
    contact_phone: String(formData.get("contact_phone") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    accommodations: String(formData.get("accommodations") ?? ""),
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

  // Get previous state for audit. pay_rate_cents is RLS-locked from
  // end-user JWTs (migration 20260601040000), so we use the admin
  // client and add an explicit org filter as the ownership check.
  const adminForBefore = createSupabaseAdminClient();
  const { data: before } = await adminForBefore
    .from("memberships")
    .select("role, status, pay_rate_cents, profile_id, display_name, contact_email, contact_phone")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .single();

  if (!before) {
    return {
      errors: {
        _form: "Couldn't find this employee in your organization. Try refreshing the page.",
      },
    };
  }

  // Build the memberships update payload (public-ish fields only).
  //
  // For shadow members, display_name is their canonical name.
  // For invited members, writing display_name here creates an admin override
  // that takes precedence in memberDisplayName() — the employee's own
  // profiles.full_name (their login identity) is left untouched.
  const updatePayload: Record<string, unknown> = {};
  if (parsed.data.role) updatePayload.role = parsed.data.role;
  if (parsed.data.status) updatePayload.status = parsed.data.status;
  if (parsed.data.pay_rate !== undefined)
    updatePayload.pay_rate_cents = parsed.data.pay_rate;
  if (parsed.data.display_name && parsed.data.display_name.length > 0) {
    updatePayload.display_name = parsed.data.display_name;
  }
  if (parsed.data.contact_email !== undefined) {
    updatePayload.contact_email = parsed.data.contact_email;
  }
  if (parsed.data.contact_phone !== undefined) {
    updatePayload.contact_phone = parsed.data.contact_phone;
  }

  // Notes and address are stored in membership_admin_data (owner/admin-only
  // RLS) so the blanket memberships SELECT policy can't expose them to
  // employees querying the Supabase REST API directly.
  const adminDataPayload: Record<string, unknown> = {};
  if (parsed.data.address !== undefined) adminDataPayload.address = parsed.data.address;
  if (parsed.data.notes !== undefined) adminDataPayload.notes = parsed.data.notes;
  if (parsed.data.accommodations !== undefined)
    adminDataPayload.accommodations = parsed.data.accommodations;

  if (
    Object.keys(updatePayload).length === 0 &&
    Object.keys(adminDataPayload).length === 0
  ) {
    return { errors: { _form: "Nothing to update." } };
  }

  // Use the service-role admin client. The role check above (owner/admin) is
  // the authoritative gate; routing through admin keeps writes immune to any
  // future policy drift that could silently drop zero-row updates.
  const admin = createSupabaseAdminClient();

  if (Object.keys(updatePayload).length > 0) {
    const { data: updated, error } = await admin
      .from("memberships")
      .update(updatePayload)
      .eq("id", memberId)
      .eq("organization_id", membership.organization_id)
      .select("id, pay_rate_cents, role, status");

    if (error) {
      return { errors: { _form: error.message } };
    }

    // If zero rows were affected, the filter didn't match — surface a clear
    // error instead of a success toast with no visible change.
    if (!updated || updated.length === 0) {
      console.error(
        "[updateMember] zero rows affected",
        { memberId, organizationId: membership.organization_id, updatePayload },
      );
      return {
        errors: {
          _form:
            "Couldn't find this employee in your organization. Try refreshing the page.",
        },
      };
    }
  }

  if (Object.keys(adminDataPayload).length > 0) {
    await (admin
      .from("membership_admin_data" as never)
      .upsert(
        {
          membership_id: memberId,
          organization_id: membership.organization_id,
          ...adminDataPayload,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "membership_id" },
      ) as unknown as Promise<unknown>);
  }

  const action = parsed.data.status === "disabled" ? "deactivate" : "update";

  await logAuditEvent({
    membership,
    action,
    entity: "membership",
    entity_id: memberId,
    before: before ?? null,
    after: { ...updatePayload, ...adminDataPayload },
  });

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");

  return { done: true };
}

/* ------------------------------------------------------------------ */
/*  Permanently delete a disabled employee                             */
/*                                                                     */
/*  Guards:                                                            */
/*   - viewer must be owner (not just admin)                          */
/*   - target must be disabled (not active / invited)                 */
/*   - cannot delete yourself                                          */
/*   - employees with payroll run entries are RESTRICT-blocked by DB; */
/*     we catch that FK error and surface a friendly message.          */
/* ------------------------------------------------------------------ */

// Return state for both delete actions. useActionState propagates
// thrown errors to the error boundary, which manifests in production
// as the generic "An error occurred in the Server Components render"
// digest message — we hit that 2026-06-01 from the payroll-guard
// throw on a member with historical payroll. Returning state instead
// keeps the failure inside the form where it can be rendered nicely.
// Only `redirect()` is allowed to throw (it's control flow that Next
// expects to throw NEXT_REDIRECT).
export type DeleteEmployeeState = { error?: string } | undefined;

export async function deleteEmployeeAction(
  _prev: DeleteEmployeeState,
  formData: FormData,
): Promise<DeleteEmployeeState> {
  const targetId = String(formData.get("id") ?? "").trim();
  if (!targetId) return { error: "Missing employee id." };

  const { membership } = await getActionContext();

  if (membership.role !== "owner") {
    return { error: "Only owners can permanently delete employees." };
  }

  if (targetId === membership.id) {
    return { error: "You cannot delete your own account." };
  }

  const admin = createSupabaseAdminClient();

  // Verify the target is disabled and belongs to this org
  const { data: target } = (await admin
    .from("memberships")
    .select("id, status, display_name")
    .eq("id", targetId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { id: string; status: string; display_name: string | null } | null;
  };

  if (!target) return { error: "Employee not found." };
  if (target.status !== "disabled") {
    return {
      error: "Only disabled employees can be deleted. Deactivate them first.",
    };
  }

  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("id", targetId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    // payroll_run_entries has ON DELETE RESTRICT — surface a helpful message
    if (
      error.message.includes("payroll_run_entries") ||
      error.code === "23503"
    ) {
      return {
        error:
          "This employee has payroll records and cannot be permanently deleted. " +
          "Keep them deactivated to preserve historical payroll data.",
      };
    }
    return { error: error.message };
  }

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "membership",
    entity_id: targetId,
    before: { id: targetId, status: "disabled" },
    after: null,
  });

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");
  redirect("/app/employees");
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

/* ------------------------------------------------------------------ */
/*  Force-remove employee (hard delete, including auth account)        */
/* ------------------------------------------------------------------ */

/**
 * Owner-only nuclear delete. Bypasses the "must be disabled first"
 * guardrail and best-effort wipes the underlying auth.users row too.
 *
 * Use cases:
 *   - The auth account got wiped from the Supabase dashboard but the
 *     membership row is still hanging around (orphaned profile_id with
 *     no profile behind it). Happens when someone cleans up via SQL or
 *     the Auth dashboard without going through /app/employees first.
 *   - An invited member never accepted, their state is mangled, and you
 *     just want a clean slate to re-invite the same email.
 *
 * Differs from deleteEmployeeAction:
 *   - No status='disabled' precondition
 *   - Tries to delete the auth user too (best-effort — if the dashboard
 *     already removed it, the 404 is swallowed silently)
 *   - Same payroll-history guardrail though: if payroll_run_entries
 *     reference this membership, the delete is blocked because dropping
 *     the row would corrupt historical payroll.
 *
 * The recipe for "Mariya can't reset her password, let's nuke her account":
 *   1. Owner clicks Force remove → membership gone, audit row written
 *   2. (Optional, if auth still existed) auth.users.delete_user runs
 *   3. Owner re-invites the same email → fresh signup flow → done.
 */
export async function forceDeleteEmployeeAction(
  _prev: DeleteEmployeeState,
  formData: FormData,
): Promise<DeleteEmployeeState> {
  const targetId = String(formData.get("id") ?? "").trim();
  if (!targetId) return { error: "Missing employee id." };

  const { membership } = await getActionContext();

  if (membership.role !== "owner") {
    return { error: "Only owners can force-remove employees." };
  }

  if (targetId === membership.id) {
    return { error: "You cannot remove your own account." };
  }

  const admin = createSupabaseAdminClient();

  const { data: target } = (await admin
    .from("memberships")
    .select("id, status, display_name, profile_id, contact_email")
    .eq("id", targetId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      status: string;
      display_name: string | null;
      profile_id: string | null;
      contact_email: string | null;
    } | null;
  };

  if (!target) return { error: "Employee not found." };

  // Best-effort: wipe the auth.users row tied to this membership. The
  // dashboard-delete path that prompted this feature already removed
  // it, so a "user not found" response is the expected normal case.
  // Any unexpected error is logged but doesn't block the membership
  // delete — orphan cleanup is the whole point of this action.
  if (target.profile_id) {
    try {
      const { error: authErr } = await admin.auth.admin.deleteUser(
        target.profile_id,
      );
      if (authErr && !/not.*found|user.*deleted/i.test(authErr.message)) {
        console.error("[force-delete] auth.users delete failed:", authErr.message);
      }
    } catch (err) {
      console.error("[force-delete] auth.users delete threw:", err);
    }
  }

  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("id", targetId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    // Same payroll guard as the normal delete — protect historical
    // pay records even in the force path.
    if (
      error.message.includes("payroll_run_entries") ||
      error.code === "23503"
    ) {
      return {
        error:
          "This employee has payroll records and cannot be force-removed. " +
          "Keep them deactivated to preserve historical payroll data.",
      };
    }
    return { error: error.message };
  }

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "membership",
    entity_id: targetId,
    before: {
      id: targetId,
      status: target.status,
      display_name: target.display_name,
      contact_email: target.contact_email,
      force_removed: true,
      auth_user_also_deleted: Boolean(target.profile_id),
    },
    after: null,
  });

  revalidatePath("/app/employees");
  revalidatePath("/app/settings/members");
  redirect("/app/employees");
}

/* ------------------------------------------------------------------ */
/*  Generate password recovery link (emergency owner/admin override)   */
/* ------------------------------------------------------------------ */

export type GenerateRecoveryLinkResult =
  | { ok: true; url: string; email: string; expires_in_minutes: number }
  | { ok: false; error: string };

/**
 * Mint a single-use password recovery link for a member and return it
 * so the owner/admin can hand-deliver it (text, DM, in-person) without
 * relying on email. Bypasses Supabase's per-email/per-hour reset rate
 * limit, which is the whole reason this exists — when an employee
 * can't reset and we've already burned our hour's allotment of emails,
 * the owner can still get them in.
 *
 * Security notes:
 *   - Owner/admin only. Same gate as the edit page.
 *   - Always audited as `generate_recovery_link` — the row records
 *     who issued the link and for whom. Hijacking an account this
 *     way is *possible* but never *invisible*.
 *   - Returns a URL pointing at our own /auth/callback?token_hash=...
 *     route (not Supabase's verify URL) so the Site URL allowlist
 *     can't strip the post-verify redirect. The callback then routes
 *     to /reset-password where the member sets a new password.
 *   - The token is single-use and expires in ~1 hour (Supabase default).
 *   - Shadow employees (no profile_id, manual-add only) have no auth
 *     account to recover; we surface a clean error instead of throwing.
 */
export async function generateRecoveryLinkAction(
  memberId: string,
): Promise<GenerateRecoveryLinkResult> {
  const { membership } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return {
      ok: false,
      error: "Only owners and admins can generate recovery links.",
    };
  }

  const admin = createSupabaseAdminClient();

  // Resolve the target membership in the caller's org. Cross-org access
  // is impossible because we filter on organization_id explicitly.
  const { data: target } = (await admin
    .from("memberships")
    .select("id, organization_id, profile_id, display_name, profile:profiles(full_name)")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      profile_id: string | null;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    } | null;
  };

  if (!target) {
    return { ok: false, error: "Employee not found in your organization." };
  }

  if (!target.profile_id) {
    return {
      ok: false,
      error:
        "This employee was added manually and doesn't have a login account, so there's no password to reset. Send them an invitation instead.",
    };
  }

  // Look up their actual auth email — contact_email on memberships is
  // an editable display field and may not match the account email.
  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(
    target.profile_id,
  );
  if (authErr || !authUser.user?.email) {
    return {
      ok: false,
      error:
        authErr?.message ??
        "Couldn't look up this employee's login email. They may need to re-invite.",
    };
  }

  const email = authUser.user.email;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  // generateLink with type='recovery' mints a recovery token but doesn't
  // send the email (admin API path). We grab `hashed_token` from the
  // response and build our own callback URL — Supabase's `action_link`
  // routes through /auth/v1/verify which redirects to the Site URL
  // allowlist, and any mismatch silently falls back to the bare site
  // URL (we saw exactly this 2026-06-01 when the curl-built link came
  // back with redirect_to=https://sollos3.com instead of the callback
  // path we asked for). Building our own URL sidesteps that whole class
  // of misconfig.
  const { data: linkData, error: linkErr } = (await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  })) as unknown as {
    data: {
      properties: { hashed_token: string } | null;
    } | null;
    error: { message: string } | null;
  };

  if (linkErr || !linkData?.properties?.hashed_token) {
    return {
      ok: false,
      error: linkErr?.message ?? "Couldn't mint a recovery token. Try again.",
    };
  }

  const url = `${siteUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=recovery`;

  await logAuditEvent({
    membership,
    action: "generate_recovery_link",
    entity: "membership",
    entity_id: target.id,
    after: {
      // Hashed token NOT logged — would defeat the audit purpose of
      // showing _that_ a link was issued without making the log itself
      // an account-hijacking tool. Email + member name are enough to
      // reconstruct who got recovery access.
      email,
      member_name: target.display_name ?? target.profile?.full_name ?? null,
    },
  });

  return {
    ok: true,
    url,
    email,
    // Supabase recovery tokens default to 1 hour. Surfaced in the UI
    // so the admin knows how urgent the hand-off is.
    expires_in_minutes: 60,
  };
}
