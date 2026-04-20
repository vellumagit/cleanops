"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { EstimateSchema } from "@/lib/validators/estimates";
import {
  autoBookingOnEstimateApproval,
  sendEstimateToClient,
} from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canCreateData } from "@/lib/subscription";

type Field = keyof typeof EstimateSchema.shape;
export type EstimateFormState = ActionState<Field | "pdf">;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    service_description: String(formData.get("service_description") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    status: String(formData.get("status") ?? "draft"),
    total_cents: String(formData.get("total_cents") ?? ""),
  };
}

function maybeStamp(status: string, prev?: { sent_at?: string | null; decided_at?: string | null }) {
  const now = new Date().toISOString();
  return {
    sent_at:
      status === "sent" || status === "approved" || status === "declined"
        ? prev?.sent_at ?? now
        : null,
    decided_at:
      status === "approved" || status === "declined"
        ? prev?.decided_at ?? now
        : null,
  };
}

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["application/pdf"];

/**
 * Upload a PDF to org-assets/{org}/estimates/{estimateId}.pdf
 * Returns the public URL or null.
 */
async function uploadEstimatePdf(
  orgId: string,
  estimateId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { url: null, error: "Only PDF files are allowed." };
  }
  if (file.size > MAX_PDF_SIZE) {
    return { url: null, error: "PDF must be under 10 MB." };
  }

  const admin = createSupabaseAdminClient();
  const path = `${orgId}/estimates/${estimateId}.pdf`;
  const { error } = await admin.storage
    .from("org-assets")
    .upload(path, file, {
      upsert: true,
      contentType: "application/pdf",
      cacheControl: "3600",
    });

  if (error) return { url: null, error: error.message };

  const { data: urlData } = admin.storage
    .from("org-assets")
    .getPublicUrl(path);

  return { url: `${urlData.publicUrl}?v=${Date.now()}`, error: null };
}

/**
 * Remove any existing PDF for an estimate from storage.
 */
async function removeEstimatePdf(orgId: string, estimateId: string) {
  const admin = createSupabaseAdminClient();
  await admin.storage
    .from("org-assets")
    .remove([`${orgId}/estimates/${estimateId}.pdf`]);
}

export async function createEstimateAction(
  _prev: EstimateFormState,
  formData: FormData,
): Promise<EstimateFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(EstimateSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  if (!(await canCreateData(membership.organization_id))) {
    return { errors: { _form: "Your subscription has expired. Subscribe to create new estimates." }, values: raw };
  }

  const stamps = maybeStamp(parsed.data.status);
  const { data: estimate, error } = await supabase
    .from("estimates")
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      service_description: parsed.data.service_description ?? null,
      notes: parsed.data.notes ?? null,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      sent_at: stamps.sent_at,
      decided_at: stamps.decided_at,
    })
    .select("id")
    .single();

  if (error) return { errors: { _form: error.message }, values: raw };

  // Handle PDF upload
  const pdfFile = formData.get("pdf") as File | null;
  if (pdfFile && pdfFile.size > 0) {
    const upload = await uploadEstimatePdf(
      membership.organization_id,
      estimate.id,
      pdfFile,
    );
    if (upload.error) {
      return { errors: { pdf: upload.error }, values: raw };
    }
    if (upload.url) {
      await supabase
        .from("estimates" as never)
        .update({ pdf_url: upload.url } as never)
        .eq("id", estimate.id);
    }
  }

  revalidatePath("/app/estimates");
  revalidatePath("/app");
  redirect("/app/estimates");
}

export async function updateEstimateAction(
  id: string,
  _prev: EstimateFormState,
  formData: FormData,
): Promise<EstimateFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(EstimateSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Pull previous timestamps so we don't overwrite an earlier sent_at.
  const { data: prev } = await supabase
    .from("estimates")
    .select("sent_at, decided_at")
    .eq("id", id)
    .maybeSingle();

  const stamps = maybeStamp(parsed.data.status, prev ?? undefined);

  // Handle PDF changes
  const removePdf = formData.get("remove_pdf") === "1";
  const pdfFile = formData.get("pdf") as File | null;
  let pdfUrl: string | null | undefined = undefined; // undefined = no change

  if (removePdf) {
    await removeEstimatePdf(membership.organization_id, id);
    pdfUrl = null;
  } else if (pdfFile && pdfFile.size > 0) {
    const upload = await uploadEstimatePdf(
      membership.organization_id,
      id,
      pdfFile,
    );
    if (upload.error) {
      return { errors: { pdf: upload.error }, values: raw };
    }
    pdfUrl = upload.url;
  }

  const updatePayload: Record<string, unknown> = {
    client_id: parsed.data.client_id,
    service_description: parsed.data.service_description ?? null,
    notes: parsed.data.notes ?? null,
    status: parsed.data.status,
    total_cents: parsed.data.total_cents,
    sent_at: stamps.sent_at,
    decided_at: stamps.decided_at,
  };

  if (pdfUrl !== undefined) {
    updatePayload.pdf_url = pdfUrl;
  }

  // Use the user's scoped client so RLS is enforced — never bypass it for
  // regular CRUD mutations (admin client is only for storage and webhooks).
  const { error } = await supabase
    .from("estimates" as never)
    .update(updatePayload as never)
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };

  // If the estimate was just approved, auto-create a pending booking
  if (parsed.data.status === "approved") {
    autoBookingOnEstimateApproval(id).catch(() => {});
  }

  revalidatePath("/app/estimates");
  revalidatePath(`/app/estimates/${id}/edit`);
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/estimates");
}

export type SendEstimateState = { ok?: boolean; error?: string };

/**
 * Send the estimate to the client as an email with a public-token link.
 * Generates the token on first send; subsequent sends reuse it.
 *
 * Gated by the platform CLIENT_EMAILS_PAUSED kill switch (via sendOrgEmail
 * inside the automation) and by the per-org `estimate_sent_email` toggle.
 */
export async function sendEstimateAction(
  _prev: SendEstimateState,
  formData: FormData,
): Promise<SendEstimateState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing estimate id" };

  // Membership check — anyone who can view/edit estimates can send them.
  await getActionContext();

  const result = await sendEstimateToClient(id);
  if (!result.ok) {
    return { error: result.error ?? "Could not send estimate" };
  }

  revalidatePath(`/app/estimates/${id}/edit`);
  revalidatePath("/app/estimates");
  return { ok: true };
}

export async function deleteEstimateAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  // Clean up PDF from storage
  await removeEstimatePdf(membership.organization_id, id).catch(() => {});

  const { error } = await supabase.from("estimates").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/app/estimates");
  redirect("/app/estimates");
}
