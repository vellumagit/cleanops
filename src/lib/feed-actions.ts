"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

export type FeedActionResult = { ok: true } | { ok: false; error: string };

/**
 * Create a new feed post. Only owner/admin/manager.
 */
export async function createFeedPostAction(
  formData: FormData,
): Promise<FeedActionResult> {
  const body = String(formData.get("body") ?? "").trim();
  if (!body || body.length > 5000) {
    return { ok: false, error: "Post body is required (max 5,000 characters)." };
  }

  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Only managers can post to the feed." };
  }

  // Handle image upload if present
  let imageUrl: string | null = null;
  const imageFile = formData.get("image") as File | null;
  if (imageFile && imageFile.size > 0) {
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (imageFile.size > maxSize) {
      return { ok: false, error: "Image must be under 5MB." };
    }

    // Validate by MIME type (server-side) — don't trust the extension alone
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (!allowedTypes.includes(imageFile.type)) {
      return { ok: false, error: "Only JPG, PNG, GIF, and WebP images allowed." };
    }
    const ext = imageFile.name.split(".").pop()?.toLowerCase() ?? "jpg";

    const path = `${membership.organization_id}/feed/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("org-assets")
      .upload(path, imageFile, {
        contentType: imageFile.type,
        upsert: false,
      });

    if (uploadErr) {
      console.error("[feed] image upload failed:", uploadErr.message);
      return { ok: false, error: "Failed to upload image." };
    }

    const { data: urlData } = supabase.storage
      .from("org-assets")
      .getPublicUrl(path);
    imageUrl = urlData.publicUrl;
  }

  const { error } = await (supabase
    .from("feed_posts" as never)
    .insert({
      organization_id: membership.organization_id,
      author_id: membership.id,
      body,
      image_url: imageUrl,
    } as never) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/app/feed");
  revalidatePath("/field/feed");
  return { ok: true };
}

/**
 * Delete a feed post. Author or admin.
 */
export async function deleteFeedPostAction(
  formData: FormData,
): Promise<FeedActionResult> {
  const postId = String(formData.get("post_id") ?? "");
  if (!postId) return { ok: false, error: "Missing post ID." };

  const { supabase } = await getActionContext();

  const { error } = await (supabase
    .from("feed_posts" as never)
    .delete()
    .eq("id" as never, postId as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/feed");
  revalidatePath("/field/feed");
  return { ok: true };
}

/**
 * Toggle pin status on a post.
 */
export async function togglePinPostAction(
  formData: FormData,
): Promise<FeedActionResult> {
  const postId = String(formData.get("post_id") ?? "");
  const pinned = formData.get("pinned") === "true";
  if (!postId) return { ok: false, error: "Missing post ID." };

  const { supabase } = await getActionContext();

  const { error } = await (supabase
    .from("feed_posts" as never)
    .update({ pinned } as never)
    .eq("id" as never, postId as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/feed");
  revalidatePath("/field/feed");
  return { ok: true };
}
