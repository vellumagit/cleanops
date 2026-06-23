"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { DOCUMENT_CATEGORY_KEYS } from "./document-categories";

const BUCKET = "employee-documents";
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

type Result = { ok: true } | { ok: false; error: string };

/** Upload a document to a team member's file. Owner/admin only. */
export async function uploadEmployeeDocumentAction(
  membershipId: string,
  formData: FormData,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to manage documents." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File must be under 15 MB." };
  }

  let category = String(formData.get("category") ?? "other");
  if (!DOCUMENT_CATEGORY_KEYS.includes(category as never)) category = "other";
  const label = String(formData.get("label") ?? "").trim().slice(0, 200) || file.name;

  const admin = createSupabaseAdminClient();

  // Verify the membership belongs to the caller's org.
  const { data: mem } = (await admin
    .from("memberships")
    .select("id, organization_id")
    .eq("id", membershipId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (!mem) return { ok: false, error: "Employee not found." };

  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const path = `${membership.organization_id}/${membershipId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: insErr } = (await (admin
    .from("membership_documents" as never)
    .insert({
      organization_id: membership.organization_id,
      membership_id: membershipId,
      category,
      label,
      file_name: file.name,
      file_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: membership.id,
    } as never) as unknown as Promise<{ error: { message: string } | null }>));
  if (insErr) {
    // Roll back the orphaned upload so storage and the table stay in sync.
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: insErr.message };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "employee",
    entity_id: membershipId,
    after: { document: label, category, file_name: file.name },
  });

  revalidatePath(`/app/employees/${membershipId}`);
  return { ok: true };
}

/** Delete a document from a team member's file. Owner/admin only. */
export async function deleteEmployeeDocumentAction(
  documentId: string,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to manage documents." };
  }

  const admin = createSupabaseAdminClient();
  const { data: doc } = (await admin
    .from("membership_documents" as never)
    .select("id, organization_id, membership_id, file_path, label")
    .eq("id" as never, documentId)
    .maybeSingle()) as unknown as {
    data: {
      organization_id: string;
      membership_id: string;
      file_path: string;
      label: string;
    } | null;
  };
  if (!doc || doc.organization_id !== membership.organization_id) {
    return { ok: false, error: "Document not found." };
  }

  await admin.storage.from(BUCKET).remove([doc.file_path]).catch(() => {});

  const { error } = (await (admin
    .from("membership_documents" as never)
    .delete()
    .eq("id" as never, documentId) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "employee",
    entity_id: doc.membership_id,
    before: { document: doc.label },
  });

  revalidatePath(`/app/employees/${doc.membership_id}`);
  return { ok: true };
}
