"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type BrandingFormState = {
  errors?: Partial<Record<"logo" | "brand_color" | "_form", string>>;
  success?: boolean;
};

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function saveBrandingAction(
  _prev: BrandingFormState,
  formData: FormData,
): Promise<BrandingFormState> {
  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission to change branding." } };
  }

  const brandColor = String(formData.get("brand_color") ?? "").trim().replace(/^#/, "");
  const removeLogo = formData.get("remove_logo") === "1";
  const logoFile = formData.get("logo") as File | null;

  // Validate colour
  if (brandColor && !/^[0-9a-fA-F]{6}$/.test(brandColor)) {
    return { errors: { brand_color: "Enter a valid 6-digit hex colour (e.g. 4f46e5)." } };
  }

  // Get current state for audit
  const { data: before } = await supabase
    .from("organizations")
    .select("logo_url, brand_color")
    .eq("id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: { logo_url: string | null; brand_color: string | null } | null;
  };

  let logoUrl = before?.logo_url ?? null;
  const admin = createSupabaseAdminClient();

  // Handle logo upload
  if (logoFile && logoFile.size > 0) {
    if (!ALLOWED_TYPES.includes(logoFile.type)) {
      return { errors: { logo: "Logo must be a PNG, JPEG, WebP, or SVG file." } };
    }
    if (logoFile.size > MAX_FILE_SIZE) {
      return { errors: { logo: "Logo must be under 2 MB." } };
    }

    const ext = logoFile.name.split(".").pop()?.toLowerCase() ?? "png";
    const path = `${membership.organization_id}/logo.${ext}`;

    const { error: uploadError } = await admin.storage
      .from("org-assets")
      .upload(path, logoFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: logoFile.type,
      });

    if (uploadError) {
      return { errors: { logo: uploadError.message } };
    }

    const { data: publicUrl } = admin.storage
      .from("org-assets")
      .getPublicUrl(path);

    // Append cache-buster to force refresh
    logoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
  }

  // Handle logo removal
  if (removeLogo) {
    // Delete any existing logo files
    const { data: files } = await admin.storage
      .from("org-assets")
      .list(membership.organization_id);

    if (files) {
      const logoFiles = files.filter((f) => f.name.startsWith("logo."));
      if (logoFiles.length > 0) {
        await admin.storage
          .from("org-assets")
          .remove(logoFiles.map((f) => `${membership.organization_id}/${f.name}`));
      }
    }
    logoUrl = null;
  }

  // Update organization
  const updatePayload: Record<string, unknown> = {
    logo_url: logoUrl,
    brand_color: brandColor || null,
  };

  const { error } = await supabase
    .from("organizations")
    .update(updatePayload as never)
    .eq("id", membership.organization_id);

  if (error) {
    return { errors: { _form: error.message } };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    before: {
      logo_url: before?.logo_url ?? null,
      brand_color: before?.brand_color ?? null,
    },
    after: updatePayload,
  });

  revalidatePath("/app/settings/branding");
  revalidatePath("/app");

  return { success: true };
}
