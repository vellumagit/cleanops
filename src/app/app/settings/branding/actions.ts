"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maybeRedirectToSetup } from "@/lib/setup-return";

export type BrandingFormState = {
  errors?: Partial<
    Record<"logo" | "brand_color" | "google_review_url" | "_form", string>
  >;
  success?: boolean;
};

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
// NOTE: SVG is deliberately excluded. It's served from a PUBLIC bucket URL, and
// an SVG can carry <script> that executes when opened — a stored-XSS payload
// hosted under our storage origin. Raster formats only.
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Confirm the file's real bytes match the raster format it claims — a browser
 * `file.type` is attacker-controlled, so `evil.svg`/`evil.html` renamed to
 * `.png` would otherwise be accepted and served publicly.
 */
async function isRealRasterImage(file: File, claimed: string): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return false;
  const u32 = (i: number) =>
    (head[i] << 24) | (head[i + 1] << 16) | (head[i + 2] << 8) | head[i + 3];
  switch (claimed) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return (
        head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e &&
        head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a &&
        head[6] === 0x1a && head[7] === 0x0a
      );
    case "image/webp":
      return u32(0) === 0x52494646 && u32(8) === 0x57454250; // "RIFF"…"WEBP"
    default:
      return false;
  }
}

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
  const googleReviewUrl = String(formData.get("google_review_url") ?? "").trim() || null;

  // Validate colour
  if (brandColor && !/^[0-9a-fA-F]{6}$/.test(brandColor)) {
    return { errors: { brand_color: "Enter a valid 6-digit hex colour (e.g. 4f46e5)." } };
  }

  // Validate Google Review URL — must be empty or an https:// URL
  if (googleReviewUrl && !/^https:\/\//i.test(googleReviewUrl)) {
    return {
      errors: {
        google_review_url:
          "Must be a full URL starting with https:// (paste it directly from Google Business Profile).",
      },
    };
  }

  // Admin client used for BOTH storage writes AND the organizations row
  // update. The RLS policy on organizations allows UPDATE only when the
  // caller has role='owner', but this action authorizes owner+admin via
  // the explicit role check above. Using the RLS-bound client for admin
  // users resulted in silent zero-row updates (no error, toast says
  // "saved", nothing persists).
  const admin = createSupabaseAdminClient();

  // Get current state for audit
  const { data: before } = await supabase
    .from("organizations")
    .select("logo_url, brand_color")
    .eq("id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: { logo_url: string | null; brand_color: string | null } | null;
  };

  let logoUrl = before?.logo_url ?? null;

  // Handle logo upload
  if (logoFile && logoFile.size > 0) {
    if (!ALLOWED_TYPES.includes(logoFile.type)) {
      return { errors: { logo: "Logo must be a PNG, JPEG, or WebP file." } };
    }
    if (logoFile.size > MAX_FILE_SIZE) {
      return { errors: { logo: "Logo must be under 2 MB." } };
    }
    // Verify the bytes actually match the claimed raster type — never trust
    // the browser-supplied MIME on a file we serve from a public URL.
    if (!(await isRealRasterImage(logoFile, logoFile.type))) {
      return { errors: { logo: "That file isn't a valid PNG, JPEG, or WebP image." } };
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
    google_review_url: googleReviewUrl,
  };

  const { error } = await admin
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

  // If the user came from the /app/setup onboarding flow, bounce them
  // back so they see the newly-checked step. Otherwise the action just
  // returns state and the form stays on-screen with a toast.
  maybeRedirectToSetup(formData);

  return { success: true };
}
