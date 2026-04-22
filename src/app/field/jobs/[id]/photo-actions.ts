"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

export type PhotoActionResult =
  | { ok: true; photo_id: string; signed_url: string }
  | { ok: false; error: string };

export type DeletePhotoResult = { ok: true } | { ok: false; error: string };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors the bucket limit
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);

/**
 * Upload a job photo. Accepts a single image; the caller can call this
 * multiple times to add several. Returns the storage path and public URL
 * so the UI can optimistically show the new photo immediately.
 *
 * Authorization:
 *   - Must be an active member of the booking's org
 *   - Must be either the assigned cleaner OR owner/admin/manager
 */
export async function uploadJobPhotoAction(
  formData: FormData,
): Promise<PhotoActionResult> {
  const bookingId = String(formData.get("booking_id") ?? "");
  const kind = String(formData.get("kind") ?? "other") as
    | "before"
    | "after"
    | "other";
  const caption = String(formData.get("caption") ?? "").trim() || null;
  const file = formData.get("photo") as File | null;

  if (!bookingId) return { ok: false, error: "Missing booking id" };
  if (!file || file.size === 0)
    return { ok: false, error: "No photo attached" };
  if (file.size > MAX_BYTES)
    return { ok: false, error: "Photo must be under 10 MB" };
  if (!ALLOWED_MIME.has(file.type))
    return { ok: false, error: "Only JPG, PNG, HEIC, and WebP are allowed" };
  if (!["before", "after", "other"].includes(kind))
    return { ok: false, error: "Invalid photo kind" };

  const { membership, supabase } = await getActionContext();

  // Confirm the booking is in the caller's org AND the caller is allowed
  // to attach a photo to it.
  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select("id, organization_id, assigned_to")
    .eq("id", bookingId)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!booking) return { ok: false, error: "Job not found" };
  if (booking.organization_id !== membership.organization_id)
    return { ok: false, error: "Job not found" };

  const isManager = ["owner", "admin", "manager"].includes(membership.role);
  const isAssigned = booking.assigned_to === membership.id;
  if (!isManager && !isAssigned) {
    return {
      ok: false,
      error: "Only the assigned cleaner or a manager can add photos.",
    };
  }

  // Storage path: org/booking/photoId.ext — lets us prefix-delete per booking.
  const photoId = crypto.randomUUID();
  const ext =
    (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "jpg";
  const storagePath = `${booking.organization_id}/${booking.id}/${photoId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("job-photos")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    console.error("[job-photos] upload failed:", uploadErr.message);
    return { ok: false, error: "Upload failed. Try again." };
  }

  const { error: insertErr } = (await supabase
    .from("job_photos" as never)
    .insert({
      id: photoId,
      organization_id: booking.organization_id,
      booking_id: booking.id,
      storage_path: storagePath,
      kind,
      caption,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by: membership.id,
    } as never)) as unknown as { error: { message: string } | null };
  if (insertErr) {
    // Best-effort: remove the orphaned object
    await supabase.storage.from("job-photos").remove([storagePath]);
    return { ok: false, error: insertErr.message };
  }

  // Bucket is private — return a signed URL so the UI can show the photo
  // immediately without a page refresh.
  const { data: signed, error: signErr } = await supabase.storage
    .from("job-photos")
    .createSignedUrl(storagePath, 60 * 60); // 1 hour
  if (signErr || !signed) {
    console.error(
      "[job-photos] could not sign URL for optimistic render:",
      signErr?.message,
    );
  }

  revalidatePath(`/field/jobs/${bookingId}`);
  revalidatePath(`/app/bookings/${bookingId}`);

  return {
    ok: true,
    photo_id: photoId,
    signed_url: signed?.signedUrl ?? "",
  };
}

/**
 * Delete a job photo. Allowed for the uploader OR any owner/admin/manager
 * in the photo's org. RLS enforces this at the DB layer too.
 */
export async function deleteJobPhotoAction(
  formData: FormData,
): Promise<DeletePhotoResult> {
  const photoId = String(formData.get("photo_id") ?? "");
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!photoId || !bookingId)
    return { ok: false, error: "Missing photo or booking id" };

  const { supabase } = await getActionContext();

  const { data: photo, error: fetchErr } = (await supabase
    .from("job_photos" as never)
    .select("id, storage_path, booking_id")
    .eq("id" as never, photoId as never)
    .maybeSingle()) as unknown as {
    data: { id: string; storage_path: string; booking_id: string } | null;
    error: { message: string } | null;
  };
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!photo) return { ok: false, error: "Photo not found" };

  // Delete the row first — RLS handles authorization. If that succeeds,
  // the object is orphaned and we can clean it up.
  const { error: deleteRowErr } = (await supabase
    .from("job_photos" as never)
    .delete()
    .eq("id" as never, photoId as never)) as unknown as {
    error: { message: string } | null;
  };
  if (deleteRowErr) return { ok: false, error: deleteRowErr.message };

  const { error: removeErr } = await supabase.storage
    .from("job-photos")
    .remove([photo.storage_path]);
  if (removeErr) {
    console.error(
      "[job-photos] storage remove failed (row already deleted):",
      removeErr.message,
    );
    // Don't fail the action — the row is gone, object is just leaked
  }

  revalidatePath(`/field/jobs/${bookingId}`);
  revalidatePath(`/app/bookings/${bookingId}`);
  return { ok: true };
}
