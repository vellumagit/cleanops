"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4 MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export type TrainingModuleState = {
  error?: string;
  success?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────

async function uploadStepImage(
  orgId: string,
  moduleId: string,
  stepIndex: number,
  file: File,
): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return null;
  if (file.size > MAX_IMAGE_SIZE) return null;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${orgId}/training/${moduleId}/step-${stepIndex}.${ext}`;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage
    .from("org-assets")
    .upload(path, file, { cacheControl: "3600", upsert: true, contentType: file.type });

  if (error) {
    console.error("[training] image upload failed:", error.message);
    return null;
  }

  const { data: publicUrl } = admin.storage.from("org-assets").getPublicUrl(path);
  return `${publicUrl.publicUrl}?v=${Date.now()}`;
}

function parseStepsFromFormData(formData: FormData): Array<{
  title: string;
  body: string;
  imageFile: File | null;
  existingImageUrl: string | null;
  removeImage: boolean;
}> {
  const steps: Array<{
    title: string;
    body: string;
    imageFile: File | null;
    existingImageUrl: string | null;
    removeImage: boolean;
  }> = [];

  // Steps are encoded as step_0_title, step_0_body, step_0_image, etc.
  let i = 0;
  while (formData.has(`step_${i}_title`) || formData.has(`step_${i}_body`)) {
    const title = String(formData.get(`step_${i}_title`) ?? "").trim();
    const body = String(formData.get(`step_${i}_body`) ?? "").trim();
    const imageFile = formData.get(`step_${i}_image`) as File | null;
    const existingImageUrl = String(formData.get(`step_${i}_existing_image`) ?? "");
    const removeImage = formData.get(`step_${i}_remove_image`) === "1";

    // Only add steps that have content
    if (title || body) {
      steps.push({
        title,
        body: title && body ? `**${title}**\n\n${body}` : title || body,
        imageFile: imageFile && imageFile.size > 0 ? imageFile : null,
        existingImageUrl: existingImageUrl || null,
        removeImage,
      });
    }
    i++;
  }
  return steps;
}

// ── Create ─────────────────────────────────────────────────────

export async function createTrainingModuleAction(
  _prev: TrainingModuleState,
  formData: FormData,
): Promise<TrainingModuleState> {
  const { membership, supabase } = await getActionContext();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const status = String(formData.get("status") ?? "draft");

  if (!title) return { error: "Title is required" };
  if (title.length > 200) return { error: "Title must be 200 characters or less" };

  const steps = parseStepsFromFormData(formData);

  // Create the module
  const { data: module, error: modErr } = await supabase
    .from("training_modules")
    .insert({
      organization_id: membership.organization_id,
      title,
      description: description || null,
      created_by: membership.id,
      status: status as never,
    } as never)
    .select("id")
    .single();

  if (modErr || !module) {
    return { error: modErr?.message ?? "Failed to create module" };
  }

  // Upload images and create steps
  if (steps.length > 0) {
    const stepRows = await Promise.all(
      steps.map(async (step, idx) => {
        let imageUrl: string | null = null;
        if (step.imageFile) {
          imageUrl = await uploadStepImage(
            membership.organization_id,
            module.id,
            idx,
            step.imageFile,
          );
        }
        return {
          organization_id: membership.organization_id,
          module_id: module.id,
          ord: idx,
          body: step.body,
          image_url: imageUrl,
        };
      }),
    );

    const { error: stepErr } = await supabase
      .from("training_steps")
      .insert(stepRows);

    if (stepErr) {
      console.error("[training] step insert failed:", stepErr.message);
    }
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "training_module",
    entity_id: module.id,
    after: { title, status, step_count: steps.length },
  });

  revalidatePath("/app/training");
  redirect("/app/training");
}

// ── Update ─────────────────────────────────────────────────────

export async function updateTrainingModuleAction(
  moduleId: string,
  _prev: TrainingModuleState,
  formData: FormData,
): Promise<TrainingModuleState> {
  const { membership, supabase } = await getActionContext();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const status = String(formData.get("status") ?? "draft");

  if (!title) return { error: "Title is required" };
  if (title.length > 200) return { error: "Title must be 200 characters or less" };

  const steps = parseStepsFromFormData(formData);

  // Update the module
  const { error: modErr } = await supabase
    .from("training_modules")
    .update({
      title,
      description: description || null,
      status: status as never,
    } as never)
    .eq("id", moduleId);

  if (modErr) return { error: modErr.message };

  // Delete existing steps and re-insert (simpler than diffing)
  await supabase.from("training_steps").delete().eq("module_id", moduleId);

  if (steps.length > 0) {
    const stepRows = await Promise.all(
      steps.map(async (step, idx) => {
        let imageUrl: string | null = step.existingImageUrl;

        if (step.removeImage) {
          imageUrl = null;
        }
        if (step.imageFile) {
          imageUrl = await uploadStepImage(
            membership.organization_id,
            moduleId,
            idx,
            step.imageFile,
          );
        }

        return {
          organization_id: membership.organization_id,
          module_id: moduleId,
          ord: idx,
          body: step.body,
          image_url: imageUrl,
        };
      }),
    );

    const { error: stepErr } = await supabase
      .from("training_steps")
      .insert(stepRows);

    if (stepErr) {
      console.error("[training] step re-insert failed:", stepErr.message);
    }
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "training_module",
    entity_id: moduleId,
    after: { title, status, step_count: steps.length },
  });

  revalidatePath("/app/training");
  revalidatePath(`/app/training/${moduleId}/edit`);
  redirect("/app/training");
}

// ── Delete ─────────────────────────────────────────────────────

export async function deleteTrainingModuleAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  const { data: prev } = await supabase
    .from("training_modules")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  // Steps cascade via FK on delete
  const { error } = await supabase.from("training_modules").delete().eq("id", id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "training_module",
    entity_id: id,
    before: prev ?? null,
  });

  revalidatePath("/app/training");
  redirect("/app/training");
}
