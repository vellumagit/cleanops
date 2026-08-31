"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { CLIENT_DOCUMENT_CATEGORY_KEYS } from "./document-categories";

const BUCKET = "client-documents";
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — matches the bucket limit
// Mirrors the bucket's allowed_mime_types so a wrong file fails here with
// a readable message instead of a storage-layer error.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

// Browsers (iOS HEIC especially) sometimes send an empty file.type; infer
// from the extension so those don't sail past the allowlist only to die
// at the bucket with a raw storage error.
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

function resolveMime(file: File): string | null {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

type Result = { ok: true } | { ok: false; error: string };

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

/** Upload a document to a client's record. Owner/admin/manager. */
export async function uploadClientDocumentAction(
  clientId: string,
  formData: FormData,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!canManage(membership.role)) {
    return { ok: false, error: "You don't have permission to manage documents." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File must be under 20 MB." };
  }
  const mime = resolveMime(file);
  if (!mime || !ALLOWED_MIME.has(mime)) {
    return { ok: false, error: "Only PDFs and images can be attached here." };
  }

  let category = String(formData.get("category") ?? "other");
  if (!CLIENT_DOCUMENT_CATEGORY_KEYS.includes(category as never)) {
    category = "other";
  }
  const label =
    String(formData.get("label") ?? "").trim().slice(0, 200) || file.name;

  const admin = createSupabaseAdminClient();

  // Verify the client belongs to the caller's org.
  const { data: client } = (await admin
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (!client) return { ok: false, error: "Client not found." };

  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const path = `${membership.organization_id}/${clientId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: insErr } = (await (admin
    .from("client_documents" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      category,
      label,
      file_name: file.name,
      file_path: path,
      mime_type: mime,
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
    entity: "client",
    entity_id: clientId,
    after: { document: label, category, file_name: file.name },
  });

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/** Delete a document from a client's record. Owner/admin/manager. */
export async function deleteClientDocumentAction(
  documentId: string,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!canManage(membership.role)) {
    return { ok: false, error: "You don't have permission to manage documents." };
  }

  const admin = createSupabaseAdminClient();
  const { data: doc } = (await admin
    .from("client_documents" as never)
    .select("id, organization_id, client_id, file_path, label")
    .eq("id" as never, documentId)
    .maybeSingle()) as unknown as {
    data: {
      organization_id: string;
      client_id: string;
      file_path: string;
      label: string;
    } | null;
  };
  if (!doc || doc.organization_id !== membership.organization_id) {
    return { ok: false, error: "Document not found." };
  }

  await admin.storage.from(BUCKET).remove([doc.file_path]).catch(() => {});

  const { error } = (await (admin
    .from("client_documents" as never)
    .delete()
    .eq("id" as never, documentId) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "client",
    entity_id: doc.client_id,
    before: { document: doc.label },
  });

  revalidatePath(`/app/clients/${doc.client_id}`);
  return { ok: true };
}
