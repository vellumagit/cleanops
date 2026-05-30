"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { ServiceTypeRowSchema } from "@/lib/validators/service-types";

type Field = keyof typeof ServiceTypeRowSchema.shape;
export type ServiceTypeFormState = ActionState<Field & string>;

function readFormValues(formData: FormData) {
  return {
    category: String(formData.get("category") ?? "other"),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    default_duration_minutes: String(
      formData.get("default_duration_minutes") ?? "",
    ),
    default_price_cents: String(formData.get("default_price_cents") ?? ""),
    color: String(formData.get("color") ?? ""),
    sort_order: String(formData.get("sort_order") ?? "100"),
    is_active: String(formData.get("is_active") ?? ""),
  };
}

/**
 * Create a new service in the current org's catalog. Only owners +
 * admins. Name uniqueness is enforced by a UNIQUE constraint at the
 * DB level; we surface a friendly message when the insert collides.
 */
export async function createServiceTypeAction(
  _prev: ServiceTypeFormState,
  formData: FormData,
): Promise<ServiceTypeFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ServiceTypeRowSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const membership = await requireMembership(["owner", "admin"]);
  const { supabase } = await getActionContext();

  const { data: row, error } = (await supabase
    .from("service_types" as never)
    .insert({
      organization_id: membership.organization_id,
      category: parsed.data.category,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      default_duration_minutes: parsed.data.default_duration_minutes ?? null,
      default_price_cents: parsed.data.default_price_cents ?? null,
      color: parsed.data.color ?? null,
      sort_order: parsed.data.sort_order,
      is_active: parsed.data.is_active,
      created_by: membership.id,
    } as never)
    .select("id")
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: { code?: string; message: string } | null;
  };

  if (error) {
    // Postgres unique-violation code (organizational_id, name)
    if (error.code === "23505") {
      return {
        errors: { name: "A service with that name already exists." },
        values: raw,
      };
    }
    return { errors: { _form: error.message }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "service_type",
    entity_id: row?.id ?? null,
    after: parsed.data as Record<string, unknown>,
  });

  revalidatePath("/app/settings/services");
  return {};
}

/**
 * Update an existing service. Owners + admins only. The row's
 * organization_id stays pinned — caller can't move services between
 * orgs even by tampering with the form.
 */
export async function updateServiceTypeAction(
  id: string,
  _prev: ServiceTypeFormState,
  formData: FormData,
): Promise<ServiceTypeFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ServiceTypeRowSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const membership = await requireMembership(["owner", "admin"]);
  const { supabase } = await getActionContext();

  // Read the pre-update state so the audit log has a meaningful before.
  const { data: before } = (await supabase
    .from("service_types" as never)
    .select(
      "category, name, description, default_duration_minutes, default_price_cents, color, sort_order, is_active",
    )
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: Record<string, unknown> | null;
  };

  const { error } = (await supabase
    .from("service_types" as never)
    .update({
      category: parsed.data.category,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      default_duration_minutes: parsed.data.default_duration_minutes ?? null,
      default_price_cents: parsed.data.default_price_cents ?? null,
      color: parsed.data.color ?? null,
      sort_order: parsed.data.sort_order,
      is_active: parsed.data.is_active,
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)) as unknown as {
    error: { code?: string; message: string } | null;
  };

  if (error) {
    if (error.code === "23505") {
      return {
        errors: { name: "A service with that name already exists." },
        values: raw,
      };
    }
    return { errors: { _form: error.message }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "service_type",
    entity_id: id,
    before,
    after: parsed.data as Record<string, unknown>,
  });

  revalidatePath("/app/settings/services");
  return {};
}

/**
 * Archive a service. We never hard-delete because bookings + contracts
 * reference the row via service_type_id — deleting would orphan their
 * historical link. Archive flips is_active=false and stamps
 * archived_at; the row disappears from the booking form's dropdown
 * but historical bookings still resolve their label.
 */
export async function archiveServiceTypeAction(id: string): Promise<void> {
  const membership = await requireMembership(["owner", "admin"]);
  const { supabase } = await getActionContext();

  await supabase
    .from("service_types" as never)
    .update({
      is_active: false,
      archived_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never);

  await logAuditEvent({
    membership,
    action: "archive",
    entity: "service_type",
    entity_id: id,
  });

  revalidatePath("/app/settings/services");
}

/**
 * Reverse archive — flip is_active back on. Useful when an owner
 * archived something by mistake.
 */
export async function unarchiveServiceTypeAction(id: string): Promise<void> {
  const membership = await requireMembership(["owner", "admin"]);
  const { supabase } = await getActionContext();

  await supabase
    .from("service_types" as never)
    .update({
      is_active: true,
      archived_at: null,
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never);

  await logAuditEvent({
    membership,
    action: "restore",
    entity: "service_type",
    entity_id: id,
  });

  revalidatePath("/app/settings/services");
}
