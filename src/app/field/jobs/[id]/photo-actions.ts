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
      // "ftyp" at offset 4..7, brand at 8..11 is one of the HEIF family.
      // Apple variants seen in the wild: heic, heix, hevc, hevx, mif1, msf1,
      // heim, heis, hevm, hevs. Some iPhone 15 Pro outputs use heif/mif2/
      // msf2; AVIF (HEIF cousin) uses avif/avis. Browsers consistently
      // report Content-Type: image/heic for all of these.
      const ftyp = u32(4) === 0x66747970;
      if (!ftyp) return false;
      const brand =
        String.fromCharCode(head[8], head[9], head[10], head[11]);
      return [
        "heic",
        "heix",
        "hevc",
        "hevx",
        "mif1",
        "msf1",
        "heim",
        "heis",
        "hevm",
        "hevs",
        "heif",
        "mif2",
        "msf2",
        "avif",
        "avis",
      ].includes(brand);
    }
    default:
      return false;
  }
}

/**
 * The image's real type from its bytes, as one of the four types the
 * job-photos bucket accepts, or null.
 *
 * Android's gallery is loose about what it claims: a photo picked from
 * Samsung Gallery or Google Photos can arrive as "image/heif", "image/jpg",
 * or with no type at all. Checking the claim against a fixed list refused
 * those even though the bytes were a perfectly good photo. The bytes decide
 * now; any HEIF-family file is stored as image/heic, which is what the
 * bucket allows.
 */
async function sniffPhotoType(file: File): Promise<"image/jpeg" | "image/png" | "image/webp" | "image/heic" | null> {
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic"] as const) {
    if (await validateMagicBytes(file, t)) return t;
  }
  return null;
}

const EXT_FOR: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

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
  if (!["before", "after", "other"].includes(kind))
    return { ok: false, error: "Invalid photo kind" };

  // Browsers will happily lie about Content-Type, so the bytes decide what
  // this is (sniffPhotoType) and that is what gets stored and served.
  // Executable bytes labelled "image/jpeg" match no image signature and are
  // refused.
  const photoType = await sniffPhotoType(file);
  if (!photoType || !ALLOWED_MIME.has(photoType)) {
    return { ok: false, error: "Only JPG, PNG, HEIC, and WebP photos can be added." };
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
  // Anyone on the crew, not just the first person. This checked
  // assigned_to alone, so the second cleaner on a team job was told "Only
  // the assigned cleaner or a manager can add photos" on a job she was
  // working.
  let isAssigned = booking.assigned_to === membership.id;
  if (!isAssigned && !isManager) {
    const { data: crewRow } = (await supabase
      .from("booking_assignees" as never)
      .select("membership_id")
      .eq("booking_id" as never, booking.id as never)
      .eq("membership_id" as never, membership.id as never)
      .maybeSingle()) as unknown as { data: { membership_id: string } | null };
    isAssigned = crewRow != null;
  }
  if (!isManager && !isAssigned) {
    return {
      ok: false,
      error: "Only the assigned cleaner or a manager can add photos.",
    };
  }

  // Storage path: org/booking/photoId.ext — lets us prefix-delete per booking.
  const photoId = crypto.randomUUID();
  const ext = EXT_FOR[photoType] ?? "jpg";
  const storagePath = `${booking.organization_id}/${booking.id}/${photoId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("job-photos")
    .upload(storagePath, file, {
      contentType: photoType,
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
      mime_type: photoType,
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
