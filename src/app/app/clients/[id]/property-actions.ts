"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

export type PropertyFormState = {
  errors?: Partial<Record<"label" | "address" | "_form", string>>;
  done?: boolean;
};

type Result = { ok: true } | { ok: false; error: string };

async function ownerAdminManager() {
  const { membership } = await getActionContext();
  return {
    membership,
    ok: ["owner", "admin", "manager"].includes(membership.role),
  };
}

/**
 * Create or update one of a client's properties.
 *
 * Writes run on the service role, so the org check below is the tenancy
 * boundary — a forged client_id or property_id in the form is the only thing
 * between one company and another company's addresses and door codes. It is
 * checked on every path, including the update path where it would be easy to
 * assume the property id alone is enough.
 */
export async function saveClientPropertyAction(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const { membership, ok } = await ownerAdminManager();
  if (!ok) {
    return { errors: { _form: "You don't have permission to do that." } };
  }

  const label = String(formData.get("label") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const accessNotes = String(formData.get("access_notes") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const templateId =
    String(formData.get("default_checklist_template_id") ?? "").trim() || null;

  if (!label) return { errors: { label: "Give this property a name." } };
  if (label.length > 120) {
    return { errors: { label: "Keep the name under 120 characters." } };
  }
  if (!clientId) return { errors: { _form: "Missing client." } };

  const admin = createSupabaseAdminClient();

  const { data: client } = (await admin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (!client) return { errors: { _form: "Client not found." } };

  const payload = {
    label,
    address,
    access_notes: accessNotes,
    notes,
    default_checklist_template_id: templateId,
  };

  if (propertyId) {
    // Scoped by org as well as id — the id alone would let a forged form
    // rewrite another tenant's property.
    const { error } = (await admin
      .from("client_properties" as never)
      .update(payload as never)
      .eq("id" as never, propertyId as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )) as unknown as { error: { message: string } | null };
    if (error) return { errors: { _form: friendly(error.message) } };
  } else {
    const { error } = (await admin.from("client_properties" as never).insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      ...payload,
    } as never)) as unknown as { error: { message: string } | null };
    if (error) return { errors: { _form: friendly(error.message) } };
  }

  await logAuditEvent({
    membership,
    action: propertyId ? "update" : "create",
    entity: "client",
    entity_id: clientId,
    after: { property_label: label, property_address: address },
  });

  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app/bookings");
  return { done: true };
}

/**
 * Archive rather than delete.
 *
 * A property with jobs against it is referenced by bookings and by the
 * invoices drawn from them; the FK refuses a hard delete for exactly that
 * reason. Archiving hides it from the pickers and frees its name for reuse
 * while leaving every past job pointing at a row that still resolves.
 */
export async function archiveClientPropertyAction(
  formData: FormData,
): Promise<Result> {
  const { membership, ok } = await ownerAdminManager();
  if (!ok) return { ok: false, error: "You don't have permission to do that." };

  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!propertyId) return { ok: false, error: "Missing property." };

  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("client_properties" as never)
    .select("id, client_id, label")
    .eq("id" as never, propertyId as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: { id: string; client_id: string; label: string } | null;
  };
  if (!row) return { ok: false, error: "Property not found." };

  const { error } = (await admin
    .from("client_properties" as never)
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id" as never, propertyId as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "archive",
    entity: "client",
    entity_id: row.client_id,
    after: { property_label: row.label, archived: true },
  });

  revalidatePath(`/app/clients/${row.client_id}`);
  revalidatePath("/app/bookings");
  return { ok: true };
}

/** The unique index speaks Postgres; the owner speaks English. */
function friendly(message: string): string {
  if (message.includes("client_properties_client_label_key")) {
    return "This client already has a property with that name.";
  }
  return message;
}
