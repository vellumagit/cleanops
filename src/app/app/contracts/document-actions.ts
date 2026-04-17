"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const BUCKET = "contract-docs";
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export async function uploadContractDocumentAction(
  formData: FormData,
): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  const contractId = String(formData.get("contract_id") ?? "");
  const file = formData.get("file") as File | null;

  if (!contractId || !file || file.size === 0) return;
  if (file.size > MAX_SIZE) return;
  if (!ALLOWED_TYPES.includes(file.type)) return;

  // Sanitize filename: strip non-alphanumeric except dots, dashes, underscores
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uid = crypto.randomUUID().slice(0, 8);
  const storagePath = `${membership.organization_id}/${contractId}/${uid}-${safeName}`;

  const admin = createSupabaseAdminClient();

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) return;

  await (admin
    .from("contract_documents" as never)
    .insert({
      organization_id: membership.organization_id,
      contract_id: contractId,
      name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by: membership.id,
    } as never) as unknown as Promise<unknown>);

  revalidatePath(`/app/contracts/${contractId}/edit`, "page");
}

export async function deleteContractDocumentAction(
  formData: FormData,
): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  const docId = String(formData.get("id") ?? "");
  const contractId = String(formData.get("contract_id") ?? "");
  if (!docId || !contractId) return;

  const admin = createSupabaseAdminClient();

  // Fetch the doc to get storage_path (verify org ownership)
  const { data: doc } = await (admin
    .from("contract_documents" as never)
    .select("storage_path")
    .eq("id" as never, docId as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle() as unknown as Promise<{ data: { storage_path: string } | null }>);

  if (!doc) return;

  await admin.storage.from(BUCKET).remove([doc.storage_path]);

  await (admin
    .from("contract_documents" as never)
    .delete()
    .eq("id" as never, docId as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  revalidatePath(`/app/contracts/${contractId}/edit`, "page");
}
