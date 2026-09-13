"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extensionFor, isRealRasterImage } from "@/lib/file-sniff";

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

  // PCI guard: feed posts persist long-term and can be read by every
  // employee in the org. Reject any Luhn-validated card number.
  const { noCardNumber, CARD_DETECTED_MESSAGE } = await import(
    "@/lib/card-detection"
  );
  if (!noCardNumber(body)) {
    return { ok: false, error: CARD_DETECTED_MESSAGE };
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

    // The label AND the bytes: org-assets is a public bucket, so whatever
    // lands here is served to the internet under Sollos's storage origin.
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (!allowedTypes.includes(imageFile.type)) {
      return { ok: false, error: "Only JPG, PNG, GIF, and WebP images allowed." };
    }
    if (!(await isRealRasterImage(imageFile, imageFile.type))) {
      return { ok: false, error: "That file isn't the image it claims to be." };
    }
    const ext = extensionFor(imageFile.type, "jpg");

    // Admin client: the bucket's insert policy admits owners and admins,
    // but this action admits managers too (checked above), whose uploads
    // failed with "Failed to upload image." for as long as the feed existed.
    const path = `${membership.organization_id}/feed/${Date.now()}.${ext}`;
    const { error: uploadErr } = await createSupabaseAdminClient().storage
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

  const { supabase, membership } = await getActionContext();

  // The image goes with the post. It sat in the public bucket forever
  // after a delete, a stable anonymous URL to whatever had been posted.
  const { data: post } = (await supabase
    .from("feed_posts" as never)
    .select("image_url")
    .eq("id" as never, postId as never)
    .maybeSingle()) as unknown as { data: { image_url: string | null } | null };

  const { error } = await (supabase
    .from("feed_posts" as never)
    .delete()
    .eq("id" as never, postId as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);

  if (error) return { ok: false, error: error.message };

  const marker = "/org-assets/";
  const at = post?.image_url?.indexOf(marker) ?? -1;
  if (at >= 0) {
    const objectPath = decodeURIComponent(post!.image_url!.slice(at + marker.length).split("?")[0]);
    if (objectPath.startsWith(`${membership.organization_id}/feed/`)) {
      await createSupabaseAdminClient().storage.from("org-assets").remove([objectPath]);
    }
  }

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
