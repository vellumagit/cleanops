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
 * Magic-byte sniffer: detects file format from the first ~12 bytes,
 * ignoring what the browser claims in `file.type`. Returns true only if
 * the file actually IS the format the browser is claiming. Protects
 * against `evil.exe` uploaded with `Content-Type: image/jpeg` — without
 * this check the row + storage object are both accepted and we'd be
 * serving malware via signed URLs.
 *
 * Signatures (per https://en.wikipedia.org/wiki/List_of_file_signatures):
 *   JPEG: FF D8 FF
 *   PNG : 89 50 4E 47 0D 0A 1A 0A
 *   WEBP: 52 49 46 46 .. .. .. .. 57 45 42 50  (RIFF...WEBP)
 *   HEIC: 00 00 00 .. 66 74 79 70 (heic|heix|hevc|mif1|msf1)
 */
async function validateMagicBytes(
  file: File,
  claimedType: string,
): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head.length < 12) return false;

  const u32 = (i: number) =>
    (head[i] << 24) | (head[i + 1] << 16) | (head[i + 2] << 8) | head[i + 3];

  switch (claimedType) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return (
        head[0] === 0x89 &&
        head[1] === 0x50 &&
        head[2] === 0x4e &&
        head[3] === 0x47 &&
        head[4] === 0x0d &&
        head[5] === 0x0a &&
        head[6] === 0x1a &&
        head[7] === 0x0a
      );
    case "image/webp": {
      // "RIFF" at 0..3 and "WEBP" at 8..11
      const isRiff = u32(0) === 0x52494646;
      const isWebp = u32(8) === 0x57454250;
      return isRiff && isWebp;
    }
    case "image/heic": {
      // "ftyp" at offset 4..7, brand at 8..11 is one of heic, heix, hevc, mif1, msf1.
      const ftyp = u32(4) === 0x66747970;
      if (!ftyp) return false;
      const brand =
        String.fromCharCode(head[8], head[9], head[10], head[11]);
      return ["heic", "heix", "hevc", "mif1", "msf1"].includes(brand);
    }
    default:
      return false;
  }
}

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

  // Browsers will happily lie about Content-Type. Verify the actual file
  // contents match what's claimed — otherwise an attacker could upload
  // executable bytes as "image/jpeg" and we'd serve them via signed URL.
  if (!(await validateMagicBytes(file, file.type))) {
    return {
      ok: false,
      error: "File does not appear to be a valid image of the claimed type.",
    };
  }

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
