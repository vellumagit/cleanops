"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

const BILL_BUCKET = "subcontractor-bills";
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

type Result = { ok: true } | { ok: false; error: string };

function parseMoneyToCents(raw: unknown): number | null {
  const n = Number(String(raw ?? "").trim().replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

async function ownerAdmin() {
  const { membership } = await getActionContext();
  const ok = ["owner", "admin"].includes(membership.role);
  return { membership, ok };
}

/** Verify a subcontractor contact belongs to the caller's org. */
async function contactInOrg(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  contactId: string,
  organizationId: string,
): Promise<boolean> {
  const { data } = (await admin
    .from("freelancer_contacts")
    .select("id")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  return Boolean(data);
}

/** Record a payment made to a subcontractor. Owner/admin only. */
export async function recordPayoutAction(formData: FormData): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) return { ok: false, error: "Only owners and admins can record payments." };

  const contactId = String(formData.get("contact_id") ?? "").trim();
  const amountCents = parseMoneyToCents(formData.get("amount"));
  const paidOn = String(formData.get("paid_on") ?? "").trim() || null;
  const method = String(formData.get("method") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!contactId) return { ok: false, error: "Missing subcontractor." };
  if (!amountCents || amountCents <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }

  const admin = createSupabaseAdminClient();
  if (!(await contactInOrg(admin, contactId, membership.organization_id))) {
    return { ok: false, error: "Subcontractor not found." };
  }

  const { error } = (await (admin.from("subcontractor_payouts" as never).insert({
    organization_id: membership.organization_id,
    contact_id: contactId,
    amount_cents: amountCents,
    ...(paidOn ? { paid_on: paidOn } : {}),
    method,
    reference,
    notes,
    recorded_by: membership.id,
  } as never) as unknown as Promise<{ error: { message: string } | null }>));
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "mark_paid",
    entity: "settings",
    entity_id: contactId,
    after: { subcontractor_payout_cents: amountCents, method },
  });

  revalidatePath(`/app/freelancers/payables/${contactId}`);
  revalidatePath(`/app/freelancers/payables`);
  return { ok: true };
}

/** Delete a recorded payout. Owner/admin only. */
export async function deletePayoutAction(formData: FormData): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) return { ok: false, error: "Not authorized." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing payout." };

  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("subcontractor_payouts" as never)
    .select("id, organization_id, contact_id")
    .eq("id" as never, id as never)
    .maybeSingle()) as unknown as {
    data: { organization_id: string; contact_id: string } | null;
  };
  if (!row || row.organization_id !== membership.organization_id) {
    return { ok: false, error: "Payout not found." };
  }

  const { error } = (await (admin
    .from("subcontractor_payouts" as never)
    .delete()
    .eq("id" as never, id as never) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/freelancers/payables/${row.contact_id}`);
  revalidatePath(`/app/freelancers/payables`);
  return { ok: true };
}

/** Upload an invoice a subcontractor sent. Owner/admin only. */
export async function uploadBillAction(formData: FormData): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) return { ok: false, error: "Only owners and admins can upload invoices." };

  const contactId = String(formData.get("contact_id") ?? "").trim();
  const file = formData.get("file");
  const amountCents = parseMoneyToCents(formData.get("amount"));
  const billDate = String(formData.get("bill_date") ?? "").trim() || null;
  if (!contactId) return { ok: false, error: "Missing subcontractor." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "File must be under 15 MB." };
  const label = String(formData.get("label") ?? "").trim().slice(0, 200) || file.name;

  const admin = createSupabaseAdminClient();
  if (!(await contactInOrg(admin, contactId, membership.organization_id))) {
    return { ok: false, error: "Subcontractor not found." };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const path = `${membership.organization_id}/${contactId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await admin.storage
    .from(BILL_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: insErr } = (await (admin.from("subcontractor_bills" as never).insert({
    organization_id: membership.organization_id,
    contact_id: contactId,
    amount_cents: amountCents && amountCents >= 0 ? amountCents : null,
    ...(billDate ? { bill_date: billDate } : {}),
    label,
    file_name: file.name,
    file_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: membership.id,
  } as never) as unknown as Promise<{ error: { message: string } | null }>));
  if (insErr) {
    await admin.storage.from(BILL_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: insErr.message };
  }

  revalidatePath(`/app/freelancers/payables/${contactId}`);
  return { ok: true };
}

/** Delete an uploaded bill (file + row). Owner/admin only. */
export async function deleteBillAction(formData: FormData): Promise<Result> {
  const { membership, ok } = await ownerAdmin();
  if (!ok) return { ok: false, error: "Not authorized." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing bill." };

  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("subcontractor_bills" as never)
    .select("id, organization_id, contact_id, file_path")
    .eq("id" as never, id as never)
    .maybeSingle()) as unknown as {
    data: { organization_id: string; contact_id: string; file_path: string } | null;
  };
  if (!row || row.organization_id !== membership.organization_id) {
    return { ok: false, error: "Bill not found." };
  }

  await admin.storage.from(BILL_BUCKET).remove([row.file_path]).catch(() => {});
  const { error } = (await (admin
    .from("subcontractor_bills" as never)
    .delete()
    .eq("id" as never, id as never) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/freelancers/payables/${row.contact_id}`);
  return { ok: true };
}

/**
 * Mint a short-lived signed URL to view/download an uploaded bill file.
 * Owner/admin/manager. Returns null if not authorized or not found.
 */
export async function billDownloadUrlAction(
  billId: string,
): Promise<{ url: string } | { error: string }> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Not authorized." };
  }
  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("subcontractor_bills" as never)
    .select("organization_id, file_path")
    .eq("id" as never, billId as never)
    .maybeSingle()) as unknown as {
    data: { organization_id: string; file_path: string } | null;
  };
  if (!row || row.organization_id !== membership.organization_id) {
    return { error: "Bill not found." };
  }
  const { data, error } = await admin.storage
    .from(BILL_BUCKET)
    .createSignedUrl(row.file_path, 120);
  if (error || !data?.signedUrl) return { error: "Could not open the file." };
  return { url: data.signedUrl };
}
